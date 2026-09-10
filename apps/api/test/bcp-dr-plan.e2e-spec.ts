import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
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
interface BcpDrPlanBody {
  id: string;
  scenario: string;
  planDocumentId: string | null;
  rtoHours: number | null;
  rpoHours: number | null;
  lastTestedAt: string | null;
  nextTestDueAt: string | null;
}
interface CoverageEntry {
  scenario: string;
  hasPlan: boolean;
  plans: BcpDrPlanBody[];
}

let sharedApp: INestApplication<App> | undefined;
async function boot(): Promise<INestApplication<App>> {
  if (!sharedApp) sharedApp = await createTestApp();
  return sharedApp;
}

async function makeUser(
  app: INestApplication<App>,
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'BCP/DR E2E User', email, password: PASSWORD })
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
    // Partial UNIQUE `UserRoleAssignment_one_active_per_user_role` (migration
    // 20260920140000) means a revoked grant is HISTORY and a new grant is a
    // new row — so this creates one only when no active grant exists, rather
    // than resurrecting a revoked one and erasing its audit trail.
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

describe('Business Continuity & Disaster Recovery (e2e) — backlog Part C #72-73', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates every route behind bcp-dr.manage', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'bcp-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/bcp-dr-plans')
      .set(bearer(outsider.accessToken))
      .send({ scenario: 'system_outage' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/bcp-dr-plans')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('rejects a scenario outside the documented 5-value set', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'bcp-admin-bad',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    await request(app.getHttpServer())
      .post('/bcp-dr-plans')
      .set(bearer(admin.accessToken))
      .send({ scenario: 'zombie_apocalypse' })
      .expect(400);
  });

  it('404s creating a plan with a planDocumentId that does not reference a real Document', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'bcp-compliance-baddoc',
      'COMPLIANCE_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/bcp-dr-plans')
      .set(bearer(compliance.accessToken))
      .send({
        scenario: 'office_site_loss',
        planDocumentId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(404);
  });

  it('walks create -> list (filtered) -> get -> update -> record-test for a plan with a real linked Document', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'bcp-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const doc = await prisma.document.create({
      data: {
        category: 'OTHER',
        classification: 'INTERNAL',
        fileName: 'cyberattack-response-plan.pdf',
        storageRef: 's3://ibms/bcp-dr-e2e/cyber-plan.pdf',
        uploadedByUserId: admin.userId,
      },
    });

    const created = (
      await request(app.getHttpServer())
        .post('/bcp-dr-plans')
        .set(bearer(admin.accessToken))
        .send({
          scenario: 'cyberattack_ransomware',
          planDocumentId: doc.id,
          rtoHours: 8,
          rpoHours: 24,
        })
        .expect(201)
    ).body as BcpDrPlanBody;
    expect(created.planDocumentId).toBe(doc.id);
    expect(created.rtoHours).toBe(8);

    const list = (
      await request(app.getHttpServer())
        .get('/bcp-dr-plans?scenario=cyberattack_ransomware')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body as BcpDrPlanBody[];
    expect(list.find((p) => p.id === created.id)).toBeTruthy();

    const fetched = (
      await request(app.getHttpServer())
        .get(`/bcp-dr-plans/${created.id}`)
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body as BcpDrPlanBody;
    expect(fetched.rpoHours).toBe(24);

    const updated = (
      await request(app.getHttpServer())
        .patch(`/bcp-dr-plans/${created.id}`)
        .set(bearer(admin.accessToken))
        .send({ rtoHours: 12 })
        .expect(200)
    ).body as BcpDrPlanBody;
    expect(updated.rtoHours).toBe(12);
    expect(updated.scenario).toBe('cyberattack_ransomware'); // scenario is immutable

    const tested = (
      await request(app.getHttpServer())
        .post(`/bcp-dr-plans/${created.id}/record-test`)
        .set(bearer(admin.accessToken))
        .send({ nextTestDueAt: '2027-09-06T09:00:00.000Z' })
        .expect(201)
    ).body as BcpDrPlanBody;
    expect(tested.lastTestedAt).not.toBeNull();
    expect(tested.nextTestDueAt).toBe('2027-09-06T09:00:00.000Z');
  });

  it('404s getting or updating an unknown plan', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'bcp-compliance-404',
      'COMPLIANCE_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/bcp-dr-plans/00000000-0000-0000-0000-000000000000')
      .set(bearer(compliance.accessToken))
      .expect(404);
    await request(app.getHttpServer())
      .patch('/bcp-dr-plans/00000000-0000-0000-0000-000000000000')
      .set(bearer(compliance.accessToken))
      .send({ rtoHours: 1 })
      .expect(404);
  });

  it('computes the five-scenario coverage view, flagging a gap for a scenario with no plan', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'bcp-coverage-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );

    await request(app.getHttpServer())
      .post('/bcp-dr-plans')
      .set(bearer(admin.accessToken))
      .send({ scenario: 'insurer_service_interruption', rtoHours: 24 })
      .expect(201);

    const coverage = (
      await request(app.getHttpServer())
        .get('/bcp-dr-plans/coverage')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body as CoverageEntry[];
    expect(coverage).toHaveLength(5);
    const insurer = coverage.find(
      (c) => c.scenario === 'insurer_service_interruption',
    );
    expect(insurer?.hasPlan).toBe(true);
    expect(insurer?.plans.length).toBeGreaterThan(0);
  });
});
