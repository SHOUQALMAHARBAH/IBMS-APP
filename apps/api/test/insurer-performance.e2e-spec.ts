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
function uniqueLabel(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
interface InsurerPerformanceScoreBody {
  id: string;
  insurerId: string;
  periodLabel: string;
  quoteResponseScore: string;
  claimsServiceScore: string;
  priceScore: string;
  serviceQualityScore: string;
  computedAt: string;
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
    .send({
      fullName: 'Insurer Performance E2E User',
      email,
      password: PASSWORD,
    })
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

describe('Insurer Performance (e2e) — backlog Part C #60', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates every route behind insurer-performance.view', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'ip-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Insurer Gate Check') },
    });

    await request(app.getHttpServer())
      .post('/insurer-performance/compute')
      .set(bearer(outsider.accessToken))
      .send({ insurerId: insurer.id })
      .expect(403);
    await request(app.getHttpServer())
      .get('/insurer-performance')
      .set(bearer(outsider.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/insurer-performance/${insurer.id}/latest`)
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('rejects a partial period override', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'ip-manager-bad',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Insurer Partial Period') },
    });

    await request(app.getHttpServer())
      .post('/insurer-performance/compute')
      .set(bearer(manager.accessToken))
      .send({ insurerId: insurer.id, periodLabel: 'x' })
      .expect(422);
  });

  it('resolves the default period to the previous UTC calendar month when no period override is given', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'ip-manager-default',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Insurer Default Period') },
    });

    const res = await request(app.getHttpServer())
      .post('/insurer-performance/compute')
      .set(bearer(manager.accessToken))
      .send({ insurerId: insurer.id })
      .expect(201);
    const body = res.body as InsurerPerformanceScoreBody;
    expect(body.periodLabel).toMatch(/^\d{4}-\d{2}$/);
    expect(body.insurerId).toBe(insurer.id);
  });

  it('computes real scores from real RFQ/Quotation/Claim/Comparison data, defaults a no-activity insurer to neutral, and a recompute upserts rather than duplicating', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'ip-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    const insurerA = await prisma.insurer.create({
      data: { name: uniqueLabel('Insurer A') },
    });
    const insurerB = await prisma.insurer.create({
      data: { name: uniqueLabel('Insurer B') },
    });
    const insurerC = await prisma.insurer.create({
      data: { name: uniqueLabel('Insurer C — no activity this period') },
    });

    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Insurer Performance E2E Co'),
        ownerUserId: manager.userId,
      },
    });
    const opportunity = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    const rfq = await prisma.rFQ.create({
      data: { opportunityId: opportunity.id, insuranceLine: 'property' },
    });

    const periodLabel = uniqueLabel('2020-06');
    const periodStart = '2020-06-01';
    const periodEnd = '2020-07-01';

    // Quote-response: insurer A responds in 3 days — well inside the 9-day
    // default target (no InsurerSlaAgreement exists for this fresh insurer).
    await prisma.rFQInsurer.create({
      data: {
        rfqId: rfq.id,
        insurerId: insurerA.id,
        status: 'QUOTED',
        sentAt: new Date('2020-06-01T00:00:00.000Z'),
        respondedAt: new Date('2020-06-04T00:00:00.000Z'),
      },
    });

    // Price: A undercuts B on the same RFQ.
    const quotationA = await prisma.quotation.create({
      data: {
        rfqId: rfq.id,
        insurerId: insurerA.id,
        premium: '900.000',
        receivedAt: new Date('2020-06-05T00:00:00.000Z'),
      },
    });
    await prisma.quotation.create({
      data: {
        rfqId: rfq.id,
        insurerId: insurerB.id,
        premium: '1000.000',
        receivedAt: new Date('2020-06-05T00:00:00.000Z'),
      },
    });

    // Service quality: a subjective score supplied on A's comparison row.
    const matrix = await prisma.comparisonMatrix.create({
      data: { rfqId: rfq.id, builtAt: new Date('2020-06-06T00:00:00.000Z') },
    });
    await prisma.comparisonMatrixRow.create({
      data: {
        comparisonMatrixId: matrix.id,
        quotationId: quotationA.id,
        serviceScore: '80',
      },
    });

    // Claims service: one clean claim (no follow-up alert) on an A policy.
    const policy = await prisma.policy.create({
      data: {
        opportunityId: opportunity.id,
        customerId: customer.id,
        insurerId: insurerA.id,
        insuranceLine: 'property',
        requestedPremium: '900.000',
      },
    });
    await prisma.claim.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        lossDate: new Date('2020-06-10T00:00:00.000Z'),
        estimatedLoss: '5000.000',
        createdAt: new Date('2020-06-10T00:00:00.000Z'),
      },
    });

    const computeA1 = (
      await request(app.getHttpServer())
        .post('/insurer-performance/compute')
        .set(bearer(manager.accessToken))
        .send({ insurerId: insurerA.id, periodLabel, periodStart, periodEnd })
        .expect(201)
    ).body as InsurerPerformanceScoreBody;
    expect(computeA1.quoteResponseScore).toBe('100.00');
    expect(computeA1.priceScore).toBe('100.00');
    expect(computeA1.claimsServiceScore).toBe('100.00');
    expect(computeA1.serviceQualityScore).toBe('80.00');

    const computeC = (
      await request(app.getHttpServer())
        .post('/insurer-performance/compute')
        .set(bearer(manager.accessToken))
        .send({ insurerId: insurerC.id, periodLabel, periodStart, periodEnd })
        .expect(201)
    ).body as InsurerPerformanceScoreBody;
    expect(computeC.quoteResponseScore).toBe('50.00');
    expect(computeC.claimsServiceScore).toBe('50.00');
    expect(computeC.priceScore).toBe('50.00');
    expect(computeC.serviceQualityScore).toBe('50.00');

    const scoreA = (
      await request(app.getHttpServer())
        .get('/insurer-performance')
        .query({ insurerId: insurerA.id, periodLabel })
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as InsurerPerformanceScoreBody[];
    expect(scoreA).toHaveLength(1);
    expect(scoreA[0].id).toBe(computeA1.id);

    const latestA = (
      await request(app.getHttpServer())
        .get(`/insurer-performance/${insurerA.id}/latest`)
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as InsurerPerformanceScoreBody;
    expect(latestA.periodLabel).toBe(periodLabel);

    // Recompute for the same insurer+period must UPSERT, not duplicate.
    const computeA2 = (
      await request(app.getHttpServer())
        .post('/insurer-performance/compute')
        .set(bearer(manager.accessToken))
        .send({ insurerId: insurerA.id, periodLabel, periodStart, periodEnd })
        .expect(201)
    ).body as InsurerPerformanceScoreBody;
    expect(computeA2.id).toBe(computeA1.id);
    const afterRecompute = (
      await request(app.getHttpServer())
        .get('/insurer-performance')
        .query({ insurerId: insurerA.id, periodLabel })
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as InsurerPerformanceScoreBody[];
    expect(afterRecompute).toHaveLength(1);
  });
});
