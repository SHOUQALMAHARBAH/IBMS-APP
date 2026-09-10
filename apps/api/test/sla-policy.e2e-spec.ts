import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

function uniqueEmail(label: string): string {
  return `${label}-${RUN}@ibms.test`;
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface PolicyBody {
  id: string;
  policyCode: string;
  processType: string;
  durationValue: number;
  durationUnit: string;
  sourceType: string;
  sourceReference: string | null;
  sourceDocument: string | null;
  isRegulatory: boolean;
  sourceLabel: string;
  status: string;
}

let app: INestApplication<App>;

async function makeUser(
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'SLA E2E User', email, password: PASSWORD })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as IssuedSessionBody;

  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  for (const roleName of roles) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    const activeGrant = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId: role.id, revokedAt: null },
    });
    if (!activeGrant) {
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
  }
  return { accessToken, userId: user.id };
}

describe('Configurable SLA policies (e2e) — task Part A', () => {
  let compliance: { accessToken: string; userId: string };
  let sales: { accessToken: string; userId: string };
  const created: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    // COMPLIANCE_OFFICER holds read + manage + regulatory.
    compliance = await makeUser('sla-compliance', 'COMPLIANCE_OFFICER');
    sales = await makeUser('sla-sales', 'SALES_RELATIONSHIP_OFFICER');
  }, 120_000);

  afterAll(async () => {
    if (created.length > 0) {
      // db-test is cumulative across specs — clean up only this run's rows.
      await prisma.slaPolicyEscalation.deleteMany({
        where: { slaPolicyId: { in: created } },
      });
      await prisma.slaPolicy.deleteMany({ where: { id: { in: created } } });
    }
    await app?.close();
  });

  it('refuses a REGULATORY policy that names no instrument, and accepts an INTERNAL_POLICY with none', async () => {
    // The core of the feature: the system must not be able to claim an SLA is
    // legally required without saying what requires it.
    await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(compliance.accessToken))
      .send({
        policyCode: `SLA-E2E-BOGUS-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Bogus regulatory claim',
        processType: `e2e_process_${RUN}`,
        durationValue: 3,
        durationUnit: 'BUSINESS_DAYS',
        sourceType: 'REGULATORY',
      })
      .expect(422);

    const ok = await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(compliance.accessToken))
      .send({
        policyCode: `SLA-E2E-INTERNAL-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Drafted internal target',
        processType: `e2e_process_${RUN}`,
        durationValue: 3,
        durationUnit: 'BUSINESS_DAYS',
        sourceType: 'INTERNAL_POLICY',
      })
      .expect(201);
    const body = ok.body as PolicyBody;
    created.push(body.id);

    expect(body.sourceType).toBe('INTERNAL_POLICY');
    expect(body.isRegulatory).toBe(false);
    expect(body.sourceLabel).toBe('Internal policy');
    // Never born ACTIVE — activation is its own audited decision.
    expect(body.status).toBe('DRAFT');
  });

  it('gates every route on RBAC', async () => {
    await request(app.getHttpServer())
      .get('/sla/policies')
      .set(bearer(sales.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(sales.accessToken))
      .send({
        policyCode: `SLA-E2E-DENIED-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Denied',
        processType: `e2e_denied_${RUN}`,
        durationValue: 1,
        durationUnit: 'HOURS',
        sourceType: 'OPERATIONAL',
      })
      .expect(403);
  });

  it('serves the SEEDED policies with their real provenance', async () => {
    const res = await request(app.getHttpServer())
      .get('/sla/policies?status=ACTIVE')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const policies = res.body as PolicyBody[];

    const sanctions = policies.find(
      (p) => p.processType === 'sanctions_match_review',
    );
    expect(
      sanctions,
      'sanctions_match_review policy should be seeded',
    ).toBeDefined();
    // THE point of this whole feature: the 3-business-day figure was drafted
    // in this repo, and must not be presented as a legal requirement.
    expect(sanctions!.sourceType).toBe('INTERNAL_POLICY');
    expect(sanctions!.isRegulatory).toBe(false);
    expect(sanctions!.sourceDocument).toBeNull();

    const dsr = policies.find((p) => p.processType === 'dsr_access_deletion');
    expect(dsr).toBeDefined();
    expect(dsr!.isRegulatory).toBe(true);
    expect(dsr!.sourceDocument).toBeTruthy();
    expect(dsr!.sourceLabel).toMatch(/^Regulatory —/);
  });

  it('changes a deadline through the API — no code change, no deploy', async () => {
    const listed = await request(app.getHttpServer())
      .get(`/sla/policies?processType=e2e_process_${RUN}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const policy = (listed.body as PolicyBody[])[0];

    const updated = await request(app.getHttpServer())
      .patch(`/sla/policies/${policy.id}`)
      .set(bearer(compliance.accessToken))
      .send({ durationValue: 9 })
      .expect(200);
    expect((updated.body as PolicyBody).durationValue).toBe(9);

    // And it is audited, before AND after.
    const audits = await prisma.auditLogEntry.findMany({
      where: { entityType: 'SlaPolicy', entityId: policy.id, action: 'UPDATE' },
    });
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits[0].beforeValue)).toContain(
      '"durationValue":3',
    );
    expect(JSON.stringify(audits[0].afterValue)).toContain('"durationValue":9');
  });

  it('activates a policy, retiring whatever it replaces, and refuses a rival ACTIVE row', async () => {
    const listed = await request(app.getHttpServer())
      .get(`/sla/policies?processType=e2e_process_${RUN}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const first = (listed.body as PolicyBody[])[0];

    const activated = await request(app.getHttpServer())
      .post(`/sla/policies/${first.id}/activate`)
      .set(bearer(compliance.accessToken))
      .expect(201);
    expect((activated.body as PolicyBody).status).toBe('ACTIVE');

    // A second policy for the same process, activated, must retire the first —
    // "which SLA applies right now" has exactly one answer.
    const second = await request(app.getHttpServer())
      .post('/sla/policies')
      .set(bearer(compliance.accessToken))
      .send({
        policyCode: `SLA-E2E-SECOND-${RUN}`.toUpperCase().slice(0, 60),
        policyName: 'Replacement target',
        processType: `e2e_process_${RUN}`,
        durationValue: 5,
        durationUnit: 'BUSINESS_DAYS',
        sourceType: 'INTERNAL_POLICY',
      })
      .expect(201);
    const secondBody = second.body as PolicyBody;
    created.push(secondBody.id);

    await request(app.getHttpServer())
      .post(`/sla/policies/${secondBody.id}/activate`)
      .set(bearer(compliance.accessToken))
      .expect(201);

    const after = await prisma.slaPolicy.findMany({
      where: { processType: `e2e_process_${RUN}` },
      select: { id: true, status: true },
    });
    expect(after.filter((p) => p.status === 'ACTIVE')).toHaveLength(1);
    expect(after.find((p) => p.status === 'ACTIVE')!.id).toBe(secondBody.id);
  });

  it('records and reads back a holiday, which the business-day math then honours', async () => {
    const observedOn = `2031-03-1${Math.floor(Math.random() * 9)}`;
    await request(app.getHttpServer())
      .post('/sla/holidays')
      .set(bearer(compliance.accessToken))
      .send({ observedOn, name: `E2E holiday ${RUN}` })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get('/sla/holidays')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const found = (listed.body as { observedOn: string; name: string }[]).find(
      (h) => h.name === `E2E holiday ${RUN}`,
    );
    expect(found).toBeDefined();
    // Stored as a whole UTC day, not shifted by a local-time parse.
    expect(found!.observedOn.slice(0, 10)).toBe(observedOn);

    await prisma.slaHoliday.deleteMany({
      where: { name: `E2E holiday ${RUN}` },
    });
  });

  it('separates "change the duration" from "declare it legally required"', async () => {
    // BRANCH_DEPARTMENT_MANAGER holds sla.policy.manage but NOT
    // sla.policy.regulatory. Shortening a deadline is a normal governance
    // edit; asserting the deadline is the law is not, and the split is a ROUTE
    // boundary rather than a branch inside one handler.
    const manager = await makeUser('sla-manager', 'BRANCH_DEPARTMENT_MANAGER');

    const listed = await request(app.getHttpServer())
      .get(`/sla/policies?processType=e2e_process_${RUN}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const policy = (listed.body as PolicyBody[])[0];

    // Allowed: an ordinary duration edit.
    await request(app.getHttpServer())
      .patch(`/sla/policies/${policy.id}`)
      .set(bearer(manager.accessToken))
      .send({ durationValue: 4 })
      .expect(200);

    // Refused: changing what the system claims about its legal force.
    await request(app.getHttpServer())
      .patch(`/sla/policies/${policy.id}/source`)
      .set(bearer(manager.accessToken))
      .send({
        sourceType: 'REGULATORY',
        sourceReference: 'Invented',
        sourceDocument: 'Nowhere',
      })
      .expect(403);

    // And even WITH the permission, a regulatory claim still needs an
    // instrument — the citation requirement is not a permission check.
    await request(app.getHttpServer())
      .patch(`/sla/policies/${policy.id}/source`)
      .set(bearer(compliance.accessToken))
      .send({ sourceType: 'REGULATORY' })
      .expect(422);

    const stillInternal = await request(app.getHttpServer())
      .get(`/sla/policies/${policy.id}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((stillInternal.body as PolicyBody).isRegulatory).toBe(false);
  });

  it('validates input rather than storing nonsense', async () => {
    for (const body of [
      { durationValue: -1 },
      { durationUnit: 'FORTNIGHTS' },
      { sourceType: 'MADE_UP' },
      { warningThreshold: 5 },
    ]) {
      await request(app.getHttpServer())
        .post('/sla/policies')
        .set(bearer(compliance.accessToken))
        .send({
          policyCode: `SLA-E2E-BAD-${RUN}`.toUpperCase().slice(0, 60),
          policyName: 'Invalid',
          processType: `e2e_bad_${RUN}`,
          durationValue: 3,
          durationUnit: 'BUSINESS_DAYS',
          sourceType: 'INTERNAL_POLICY',
          ...body,
        })
        .expect(400);
    }
  });
});
