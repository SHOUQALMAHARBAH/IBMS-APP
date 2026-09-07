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
interface PlanningExportBreakdownRowBody {
  key: string;
  policyCount: number;
  totalIssuedPremiumJod: string;
}
interface MarketRowBody {
  id: string;
  insurerId: string;
  periodLabel: string;
  quoteResponseScore: string;
  claimsServiceScore: string;
  priceScore: string;
  serviceQualityScore: string;
  computedAt: string;
}
interface PlanningExportSummaryBody {
  generatedAt: string;
  periodLabel: string;
  portfolio: {
    byLine: PlanningExportBreakdownRowBody[];
    byInsurer: PlanningExportBreakdownRowBody[];
    byClientSegment: PlanningExportBreakdownRowBody[];
    byGeography: PlanningExportBreakdownRowBody[];
  };
  market: MarketRowBody[];
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
      fullName: 'Planning Export E2E User',
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
  rows: PlanningExportBreakdownRowBody[],
  key: string,
): PlanningExportBreakdownRowBody | undefined {
  return rows.find((r) => r.key === key);
}

describe('Strategic Planning Inputs (e2e) — backlog Part C #65', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the export behind planning-export.generate', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'pe-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/planning-export')
      .set(bearer(outsider.accessToken))
      .send({})
      .expect(403);
  });

  it('is the narrowest Domain G grant — NOT Manager, NOT Finance, unlike #58-63', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'pe-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const finance = await makeUser(
      app,
      'pe-finance',
      'FINANCE_COLLECTIONS_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/planning-export')
      .set(bearer(manager.accessToken))
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post('/planning-export')
      .set(bearer(finance.accessToken))
      .send({})
      .expect(403);
  });

  it('resolves the default period to the previous UTC calendar month when no override is given', async () => {
    const app = await boot();
    const exec = await makeUser(app, 'pe-exec-default', 'EXECUTIVE_MANAGEMENT');
    const res = await request(app.getHttpServer())
      .post('/planning-export')
      .set(bearer(exec.accessToken))
      .send({})
      .expect(201);
    const body = res.body as PlanningExportSummaryBody;
    expect(body.periodLabel).toMatch(/^\d{4}-\d{2}$/);
  });

  it('composes real portfolio and market data for an explicit period', async () => {
    const app = await boot();
    const exec = await makeUser(app, 'pe-exec', 'EXECUTIVE_MANAGEMENT');

    // Uniquely-named fixtures so byLine/byInsurer/market can be asserted
    // EXACTLY even against db-test's cumulative book, the #62/#63 precedent.
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Planning Export E2E Insurer') },
    });
    const line = uniqueLabel('planning-export-e2e-line');
    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Planning Export E2E Corp Co'),
        ownerUserId: exec.userId,
      },
    });
    const opportunity = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    await prisma.policy.create({
      data: {
        opportunityId: opportunity.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: line,
        status: 'ISSUED',
        requestedPremium: '5000.000',
        issuedPremium: '5000.000',
      },
    });

    // A fixed, far-future period label is safe here — `@@unique([insurerId,
    // periodLabel])` is scoped to insurerId, and `insurer` above is always
    // freshly created per test run, so it can never collide with another
    // test's row for this same period.
    const periodLabel = '2031-01';
    await prisma.insurerPerformanceScore.create({
      data: {
        insurerId: insurer.id,
        periodLabel,
        quoteResponseScore: '90.00',
        claimsServiceScore: '80.00',
        priceScore: '70.00',
        serviceQualityScore: '60.00',
      },
    });

    const res = await request(app.getHttpServer())
      .post('/planning-export')
      .set(bearer(exec.accessToken))
      .send({ periodLabel })
      .expect(201);
    const body = res.body as PlanningExportSummaryBody;

    expect(body.periodLabel).toBe(periodLabel);

    const lineRow = findRow(body.portfolio.byLine, line);
    expect(lineRow).toEqual({
      key: line,
      policyCount: 1,
      totalIssuedPremiumJod: '5000.000',
    });

    const insurerRow = findRow(body.portfolio.byInsurer, insurer.name);
    expect(insurerRow).toEqual({
      key: insurer.name,
      policyCount: 1,
      totalIssuedPremiumJod: '5000.000',
    });

    const marketRow = body.market.find((m) => m.insurerId === insurer.id);
    expect(marketRow).toMatchObject({
      insurerId: insurer.id,
      periodLabel,
      quoteResponseScore: '90.00',
      claimsServiceScore: '80.00',
      priceScore: '70.00',
      serviceQualityScore: '60.00',
    });
  });
});
