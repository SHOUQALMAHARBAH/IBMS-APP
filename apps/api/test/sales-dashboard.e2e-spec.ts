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
function uniqueLabel(base: string): string {
  return `${base} ${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
interface SalesDashboardBody {
  periodLabel: string;
  leads: {
    newLeadsCount: number;
    convertedToProspectCount: number;
    conversionRatePercent: number;
  };
  premiumWritten: { newJod: string; renewalJod: string; totalJod: string };
  commissionIncomeJod: string;
  crossSell: {
    totalCount: number;
    convertedCount: number;
    conversionRatePercent: number;
  };
  upSell: {
    totalCount: number;
    convertedCount: number;
    conversionRatePercent: number;
  };
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
    .send({ fullName: 'Sales Dashboard E2E User', email, password: PASSWORD })
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

// A distinctive, far-past window no other e2e fixture is expected to touch
// (db-test is cumulative) — isolates this test's counts from every other
// Lead/Policy/CommissionLedgerEntry/CrossSellOpportunity/UpSellRecommendation
// row in the shared test database.
const PERIOD_LABEL = '2018-03';
const PERIOD_START = '2018-03-01';
const PERIOD_END = '2018-04-01';
const IN_PERIOD = new Date('2018-03-15T00:00:00.000Z');

describe('Sales Dashboard (e2e) — backlog Part E / Process #64', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the summary behind dashboard.sales.view', async () => {
    const app = await boot();
    const outsider = await makeUser(app, 'sd-outsider', 'CLAIMS_OFFICER');
    await request(app.getHttpServer())
      .get('/dashboards/sales')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('422s a partial period override', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'sd-manager-partial',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    await request(app.getHttpServer())
      .get('/dashboards/sales?periodLabel=2018-03')
      .set(bearer(manager.accessToken))
      .expect(422);
  });

  it('computes leads/premium(new vs renewal)/commission/cross-sell/up-sell for an explicit period', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'sd-sales-walk',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // Leads: 2 new leads in period, 1 of them converted to a Prospect.
    await prisma.lead.create({
      data: {
        fullName: uniqueLabel('SD Lead Converted'),
        source: 'referral',
        ownerUserId: sales.userId,
        status: 'CONVERTED_TO_PROSPECT',
        createdAt: IN_PERIOD,
      },
    });
    await prisma.lead.create({
      data: {
        fullName: uniqueLabel('SD Lead Not Converted'),
        source: 'referral',
        ownerUserId: sales.userId,
        status: 'CONTACTED',
        createdAt: IN_PERIOD,
      },
    });

    // Premium written: one new-business policy, one renewal policy.
    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Sales Dashboard E2E Co'),
        ownerUserId: sales.userId,
      },
    });
    const newOpportunity = await prisma.opportunity.create({
      data: { customerId: customer.id, isRenewal: false },
    });
    const renewalOpportunity = await prisma.opportunity.create({
      data: { customerId: customer.id, isRenewal: true },
    });
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Sales Dashboard E2E Insurer') },
    });
    const newPolicy = await prisma.policy.create({
      data: {
        opportunityId: newOpportunity.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: 'property',
        requestedPremium: '1000.000',
        issuedPremium: '1000.000',
        placedByUserId: sales.userId,
        createdAt: IN_PERIOD,
      },
    });
    await prisma.policy.create({
      data: {
        opportunityId: renewalOpportunity.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: 'property',
        requestedPremium: '500.000',
        issuedPremium: '500.000',
        placedByUserId: sales.userId,
        createdAt: IN_PERIOD,
      },
    });

    // Commission income on the new-business policy.
    await prisma.commissionLedgerEntry.create({
      data: { policyId: newPolicy.id, amount: '150.000', createdAt: IN_PERIOD },
    });

    // Cross-sell: 2 opportunities, 1 converted.
    await prisma.crossSellOpportunity.create({
      data: {
        customerId: customer.id,
        gapLine: uniqueLabel('Public Liability'),
        status: 'CONVERTED',
        detectedAt: IN_PERIOD,
        resolvedAt: IN_PERIOD,
      },
    });
    await prisma.crossSellOpportunity.create({
      data: {
        customerId: customer.id,
        gapLine: uniqueLabel('Marine'),
        status: 'OPEN',
        detectedAt: IN_PERIOD,
      },
    });

    // Up-sell: 2 recommendations, 1 converted.
    await prisma.upSellRecommendation.create({
      data: {
        customerId: customer.id,
        currentSumInsured: '10000.000',
        currentAssetValue: '15000.000',
        status: 'CONVERTED',
        detectedAt: IN_PERIOD,
        resolvedAt: IN_PERIOD,
      },
    });
    await prisma.upSellRecommendation.create({
      data: {
        customerId: customer.id,
        currentSumInsured: '20000.000',
        currentAssetValue: '25000.000',
        status: 'OPEN',
        detectedAt: IN_PERIOD,
      },
    });

    const res = (
      await request(app.getHttpServer())
        .get(
          `/dashboards/sales?periodLabel=${PERIOD_LABEL}&periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`,
        )
        .set(bearer(sales.accessToken))
        .expect(200)
    ).body as SalesDashboardBody;

    expect(res.periodLabel).toBe(PERIOD_LABEL);
    expect(res.leads.newLeadsCount).toBeGreaterThanOrEqual(2);
    expect(res.leads.convertedToProspectCount).toBeGreaterThanOrEqual(1);
    expect(res.premiumWritten.newJod).toMatch(/^\d+\.\d{3}$/);
    expect(Number(res.premiumWritten.newJod)).toBeGreaterThanOrEqual(1000);
    expect(Number(res.premiumWritten.renewalJod)).toBeGreaterThanOrEqual(500);
    expect(Number(res.commissionIncomeJod)).toBeGreaterThanOrEqual(150);
    expect(res.crossSell.totalCount).toBeGreaterThanOrEqual(2);
    expect(res.crossSell.convertedCount).toBeGreaterThanOrEqual(1);
    expect(res.upSell.totalCount).toBeGreaterThanOrEqual(2);
    expect(res.upSell.convertedCount).toBeGreaterThanOrEqual(1);
  });

  it('scopes leads/premium/commission to one branch when branchId is given, but never cross-sell/up-sell (no owner dimension)', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'sd-manager-branch',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const branch = await prisma.branch.create({
      data: { name: uniqueLabel('Sales Dashboard E2E Branch') },
    });
    const branchUser = await makeUser(
      app,
      'sd-branch-officer',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await prisma.user.update({
      where: { id: branchUser.userId },
      data: { branchId: branch.id },
    });

    await prisma.lead.create({
      data: {
        fullName: uniqueLabel('SD Branch Lead'),
        source: 'referral',
        ownerUserId: branchUser.userId,
        status: 'NEW',
        createdAt: IN_PERIOD,
      },
    });

    const before = (
      await request(app.getHttpServer())
        .get(
          `/dashboards/sales?periodLabel=${PERIOD_LABEL}&periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`,
        )
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as SalesDashboardBody;

    const scoped = (
      await request(app.getHttpServer())
        .get(
          `/dashboards/sales?periodLabel=${PERIOD_LABEL}&periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}&branchId=${branch.id}`,
        )
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as SalesDashboardBody;

    expect(scoped.leads.newLeadsCount).toBe(1);
    expect(scoped.leads.newLeadsCount).toBeLessThan(before.leads.newLeadsCount);
  });
});
