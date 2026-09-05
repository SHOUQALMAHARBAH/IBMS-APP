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
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface RetentionCaseBody {
  id: string;
  customerId: string;
  reason: string;
  status: string;
  isClosed: boolean;
  createdAt: string;
  closedAt: string | null;
}
interface SweepResultBody {
  scanned: number;
  openedRenewalInactivity: number;
  openedLapseRisk: number;
  failed: number;
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
    .send({ fullName: 'Retention E2E User', email, password: PASSWORD })
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
    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: { revokedAt: null },
      create: { userId: user.id, roleId: role.id },
    });
  }
  return { accessToken, userId: user.id };
}

describe('Customer Retention (e2e) — backlog Part C #46', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('opens a retention case on lapse risk / renewal inactivity via the sweep, stays idempotent, and supports manual open + close', async () => {
    const app = await boot();
    const sales = await makeUser(app, 'rc-sales', 'SALES_RELATIONSHIP_OFFICER');
    const claims = await makeUser(app, 'rc-claims', 'CLAIMS_OFFICER');

    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: `Retention E2E Co ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: sales.userId,
      },
    });
    const insurer = await prisma.insurer.create({
      data: {
        name: `Retention E2E ins ${Math.random().toString(36).slice(2, 8)}`,
      },
    });

    async function makePolicyAndRenewal(
      renewalData: Partial<{
        status:
          'RENEWAL_DUE' | 'IN_PROGRESS' | 'LAPSED' | 'RENEWED' | 'CANCELLED';
        triggeredAt: Date;
      }>,
    ) {
      const opp = await prisma.opportunity.create({
        data: { customerId: customer.id },
      });
      const policy = await prisma.policy.create({
        data: {
          opportunityId: opp.id,
          customerId: customer.id,
          insurerId: insurer.id,
          insuranceLine: 'Property All Risks',
          requestedPremium: '1000.000',
          status: 'ACTIVE',
        },
      });
      const renewal = await prisma.renewalCase.create({
        data: { policyId: policy.id, ...renewalData },
      });
      return renewal;
    }

    // LAPSED -> lapse_risk regardless of triggeredAt
    const lapsed = await makePolicyAndRenewal({
      status: 'LAPSED',
      triggeredAt: daysAgo(2),
    });
    // stale + unresolved -> renewal_inactivity (60 days >> 30 business days)
    const stale = await makePolicyAndRenewal({
      status: 'RENEWAL_DUE',
      triggeredAt: daysAgo(60),
    });
    // fresh + unresolved -> not due yet
    const fresh = await makePolicyAndRenewal({
      status: 'IN_PROGRESS',
      triggeredAt: daysAgo(1),
    });
    // concluded (RENEWED) even though old -> never a candidate
    const renewed = await makePolicyAndRenewal({
      status: 'RENEWED',
      triggeredAt: daysAgo(90),
    });

    // a non-Sales/Manager actor cannot manage retention cases
    await request(app.getHttpServer())
      .post('/retention-cases/sweep')
      .set(bearer(claims.accessToken))
      .expect(403);

    // run the sweep on demand
    const swept = await request(app.getHttpServer())
      .post('/retention-cases/sweep')
      .set(bearer(sales.accessToken))
      .expect(201);
    const result = swept.body as SweepResultBody;
    expect(result.scanned).toBeGreaterThanOrEqual(3); // lapsed, stale, fresh (not renewed — excluded up front)
    expect(result.openedLapseRisk).toBeGreaterThanOrEqual(1);
    expect(result.openedRenewalInactivity).toBeGreaterThanOrEqual(1);

    // the two due RenewalCases are stamped; the fresh + renewed ones are not
    const [lapsedAfter, staleAfter, freshAfter, renewedAfter] =
      await Promise.all([
        prisma.renewalCase.findUniqueOrThrow({ where: { id: lapsed.id } }),
        prisma.renewalCase.findUniqueOrThrow({ where: { id: stale.id } }),
        prisma.renewalCase.findUniqueOrThrow({ where: { id: fresh.id } }),
        prisma.renewalCase.findUniqueOrThrow({ where: { id: renewed.id } }),
      ]);
    expect(lapsedAfter.retentionEscalatedAt).not.toBeNull();
    expect(staleAfter.retentionEscalatedAt).not.toBeNull();
    expect(freshAfter.retentionEscalatedAt).toBeNull();
    expect(renewedAfter.retentionEscalatedAt).toBeNull();

    // the corresponding RetentionCase rows exist for this customer
    const list = await request(app.getHttpServer())
      .get(`/retention-cases?customerId=${customer.id}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    const cases = list.body as RetentionCaseBody[];
    expect(cases.map((c) => c.reason).sort()).toEqual([
      'lapse_risk',
      'renewal_inactivity',
    ]);
    expect(cases.every((c) => c.status === 'open')).toBe(true);

    const reasonFiltered = await request(app.getHttpServer())
      .get(`/retention-cases?customerId=${customer.id}&reason=lapse_risk`)
      .set(bearer(sales.accessToken))
      .expect(200);
    expect(reasonFiltered.body as RetentionCaseBody[]).toHaveLength(1);

    // idempotent re-sweep: the two already-escalated cases open nothing new
    const sweptAgain = await request(app.getHttpServer())
      .post('/retention-cases/sweep')
      .set(bearer(sales.accessToken))
      .expect(201);
    const result2 = sweptAgain.body as SweepResultBody;
    expect(result2.openedLapseRisk).toBe(0);
    expect(result2.openedRenewalInactivity).toBe(0);
    const listAgain = await request(app.getHttpServer())
      .get(`/retention-cases?customerId=${customer.id}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    expect(listAgain.body as RetentionCaseBody[]).toHaveLength(2); // unchanged

    // manual open: unknown customer -> 404; unknown reason -> 400
    await request(app.getHttpServer())
      .post('/retention-cases')
      .set(bearer(sales.accessToken))
      .send({
        customerId: '11111111-1111-4111-8111-111111111111',
        reason: 'lapse_risk',
      })
      .expect(404);
    await request(app.getHttpServer())
      .post('/retention-cases')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, reason: 'churn' })
      .expect(400);

    const manual = await request(app.getHttpServer())
      .post('/retention-cases')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, reason: 'renewal_inactivity' })
      .expect(201);
    const manualCase = manual.body as RetentionCaseBody;
    expect(manualCase.status).toBe('open');

    // close it; idempotent re-close; unknown id -> 404
    const closed = await request(app.getHttpServer())
      .post(`/retention-cases/${manualCase.id}/close`)
      .set(bearer(sales.accessToken))
      .expect(201);
    expect((closed.body as RetentionCaseBody).status).toBe('closed');
    expect((closed.body as RetentionCaseBody).closedAt).not.toBeNull();
    await request(app.getHttpServer())
      .post(`/retention-cases/${manualCase.id}/close`)
      .set(bearer(sales.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post('/retention-cases/11111111-1111-4111-8111-111111111111/close')
      .set(bearer(sales.accessToken))
      .expect(404);

    const statusFiltered = await request(app.getHttpServer())
      .get(`/retention-cases?customerId=${customer.id}&status=closed`)
      .set(bearer(sales.accessToken))
      .expect(200);
    expect(
      (statusFiltered.body as RetentionCaseBody[]).map((c) => c.id),
    ).toEqual([manualCase.id]);

    await request(app.getHttpServer())
      .get(`/retention-cases/${manualCase.id}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    await request(app.getHttpServer())
      .get('/retention-cases/11111111-1111-4111-8111-111111111111')
      .set(bearer(sales.accessToken))
      .expect(404);

    // audit: a CREATE row per opened case (sweep + manual) + an UPDATE on close
    const audit = await prisma.auditLogEntry.findMany({
      where: {
        entityType: 'RetentionCase',
        entityId: { in: [...cases.map((c) => c.id), manualCase.id] },
      },
    });
    const actions = audit.map((a) => a.action);
    expect(actions.filter((a) => a === 'CREATE')).toHaveLength(3); // 2 swept + 1 manual
    expect(actions).toContain('UPDATE'); // the close
  });
});
