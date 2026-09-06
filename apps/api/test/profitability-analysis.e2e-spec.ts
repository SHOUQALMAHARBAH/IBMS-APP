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
interface ProfitabilityBreakdownRowBody {
  key: string;
  commissionIncomeJod: string;
  costToServeJod: string;
  netProfitabilityJod: string;
  policyCount: number;
  claimCount: number;
}
interface ProfitabilityAnalysisSummaryBody {
  generatedAt: string;
  byLine: ProfitabilityBreakdownRowBody[];
  bySegment: ProfitabilityBreakdownRowBody[];
  totals: Omit<ProfitabilityBreakdownRowBody, 'key'>;
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
      fullName: 'Profitability Analysis E2E User',
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
    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: { revokedAt: null },
      create: { userId: user.id, roleId: role.id },
    });
  }
  return { accessToken, userId: user.id };
}

function findRow(
  rows: ProfitabilityBreakdownRowBody[],
  key: string,
): ProfitabilityBreakdownRowBody | undefined {
  return rows.find((r) => r.key === key);
}

describe('Profitability Analysis (e2e) — backlog Part C #63', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the summary behind profitability-analysis.view', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'pfa-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/profitability-analysis')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('is NOT granted to Branch/Department Manager, unlike #58-62 (Executive Management / Finance only)', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'pfa-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    await request(app.getHttpServer())
      .get('/profitability-analysis')
      .set(bearer(manager.accessToken))
      .expect(403);
  });

  it('computes commission income vs. cost-to-serve, by line and by client segment', async () => {
    const app = await boot();
    const exec = await makeUser(app, 'pfa-exec', 'EXECUTIVE_MANAGEMENT');

    // A uniquely-named line so byLine can be asserted EXACTLY even against
    // db-test's cumulative book — bySegment (CORPORATE/INDIVIDUAL, a closed
    // 2-value set shared by the whole book) needs a before/after delta
    // instead, the #62 precedent.
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Profitability E2E Insurer') },
    });
    const line = uniqueLabel('profitability-e2e-line');
    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Profitability E2E Corp Co'),
        ownerUserId: exec.userId,
      },
    });

    const before = (
      await request(app.getHttpServer())
        .get('/profitability-analysis')
        .set(bearer(exec.accessToken))
        .expect(200)
    ).body as ProfitabilityAnalysisSummaryBody;
    const segmentBefore =
      findRow(before.bySegment, 'CORPORATE')?.policyCount ?? 0;

    const opportunity = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    const policy = await prisma.policy.create({
      data: {
        opportunityId: opportunity.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: line,
        status: 'ISSUED',
        requestedPremium: '10000.000',
        issuedPremium: '10000.000',
      },
    });
    await prisma.commissionLedgerEntry.create({
      data: { policyId: policy.id, amount: '900.000' },
    });
    const claim = await prisma.claim.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        lossDate: new Date('2026-01-15T00:00:00.000Z'),
        estimatedLoss: '400.000',
        status: 'SETTLED',
      },
    });
    await prisma.settlement.create({
      data: {
        claimId: claim.id,
        estimatedLoss: '400.000',
        netSettlement: '400.000',
      },
    });

    const after = (
      await request(app.getHttpServer())
        .get('/profitability-analysis')
        .set(bearer(exec.accessToken))
        .expect(200)
    ).body as ProfitabilityAnalysisSummaryBody;

    const lineRow = findRow(after.byLine, line);
    expect(lineRow).toEqual({
      key: line,
      commissionIncomeJod: '900.000',
      costToServeJod: '400.000',
      netProfitabilityJod: '500.000',
      policyCount: 1,
      claimCount: 1,
    });

    const segmentAfter = findRow(after.bySegment, 'CORPORATE');
    expect(segmentAfter?.policyCount).toBe(segmentBefore + 1);
  });
});
