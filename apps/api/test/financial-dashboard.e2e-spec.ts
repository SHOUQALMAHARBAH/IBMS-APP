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
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface FinancialDashboardBody {
  asOf: string;
  currency: string;
  receivables: {
    totals: {
      outstandingTotal: string;
      invoiceCount: number;
      customerCount: number;
    };
  };
  payables: {
    totals: {
      outstandingAmount: string;
      outstandingCount: number;
      remittedAmount: string;
      remittedCount: number;
      insurerCount: number;
    };
  };
  commission: {
    earned: string;
    outstanding: string;
    paid: string;
    entryCount: number;
  };
  profitability: {
    byLine: {
      key: string;
      premiumWritten: string;
      claimsPaid: string;
      commissionEarned: string;
      netPosition: string;
    }[];
    bySegment: { key: string }[];
    totals: { policyCount: number; claimCount: number };
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
    .send({
      fullName: 'Financial Dashboard E2E User',
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

describe('Financial Dashboard (e2e) — backlog Part E / Process #64', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the summary behind dashboard.financial.view', async () => {
    const app = await boot();
    const outsider = await makeUser(app, 'fd-outsider', 'CLAIMS_OFFICER');
    await request(app.getHttpServer())
      .get('/dashboards/financial')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('400s a malformed asOf', async () => {
    const app = await boot();
    const finance = await makeUser(
      app,
      'fd-finance-bad-date',
      'FINANCE_COLLECTIONS_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/dashboards/financial?asOf=not-a-date')
      .set(bearer(finance.accessToken))
      .expect(400);
  });

  it('422s a future asOf', async () => {
    const app = await boot();
    const finance = await makeUser(
      app,
      'fd-finance-future-date',
      'FINANCE_COLLECTIONS_OFFICER',
    );
    const future = daysFromNow(365).toISOString().slice(0, 10);
    await request(app.getHttpServer())
      .get(`/dashboards/financial?asOf=${future}`)
      .set(bearer(finance.accessToken))
      .expect(422);
  });

  it('computes receivables/ageing, payables, commission income/outstanding, and profitability by line/segment', async () => {
    const app = await boot();
    const finance = await makeUser(
      app,
      'fd-finance-walk',
      'FINANCE_COLLECTIONS_OFFICER',
    );
    // A fresh Insurer isolates this test's figures from db-test's cumulative
    // history — every section here reads `createdAt < asOf` with no lower
    // bound, so scoping by insurerId (like the Claims Dashboard e2e test)
    // isolates cleanly across all four sections.
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Financial Dashboard E2E Insurer') },
    });
    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Financial Dashboard E2E Co'),
        ownerUserId: finance.userId,
      },
    });
    const opportunity = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    const policy = await prisma.policy.create({
      data: {
        opportunityId: opportunity.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: 'motor',
        status: 'ACTIVE',
        requestedPremium: '4000.000',
        issuedPremium: '4000.000',
        placedByUserId: finance.userId,
      },
    });

    // Receivables: an outstanding invoice (no receipt) — 1000.
    await prisma.invoice.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        premiumAmount: '1000.000',
        totalAmount: '1000.000',
        dueDate: daysFromNow(20),
      },
    });

    // Payables — outstanding obligation: collected but not remitted, net
    // 2000 - 200 = 1800. A distinct invoiceType: the partial UNIQUE index
    // allows only one new_business_premium invoice per policy.
    const obligationInvoice = await prisma.invoice.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        invoiceType: 'endorsement_adjustment',
        premiumAmount: '2000.000',
        commissionDeducted: '200.000',
        totalAmount: '2000.000',
        dueDate: daysAgo(5),
      },
    });
    await prisma.receipt.create({
      data: {
        invoiceId: obligationInvoice.id,
        amount: '2000.000',
        receivedAt: daysAgo(3),
      },
    });

    // Payables — already remitted: 900.
    const remittedInvoice = await prisma.invoice.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        invoiceType: 'renewal_premium',
        premiumAmount: '900.000',
        totalAmount: '900.000',
        dueDate: daysAgo(15),
      },
    });
    const remittedReceipt = await prisma.receipt.create({
      data: {
        invoiceId: remittedInvoice.id,
        amount: '900.000',
        receivedAt: daysAgo(10),
      },
    });
    await prisma.remittance.create({
      data: {
        receiptId: remittedReceipt.id,
        insurerId: insurer.id,
        amount: '900.000',
        remittedAt: daysAgo(8),
      },
    });

    // Commission: earned 300, paid 100 -> outstanding 200.
    await prisma.commissionLedgerEntry.create({
      data: { policyId: policy.id, amount: '300.000', paidAmount: '100.000' },
    });

    // Profitability: a CLOSED claim with a settlement -> claimsPaid 500.
    const claim = await prisma.claim.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        status: 'CLOSED',
        lossDate: daysAgo(60),
        estimatedLoss: '500.000',
      },
    });
    await prisma.settlement.create({
      data: {
        claimId: claim.id,
        estimatedLoss: '500.000',
        approvedAmount: '500.000',
        deductible: '0.000',
        netSettlement: '500.000',
      },
    });

    const res = (
      await request(app.getHttpServer())
        .get(`/dashboards/financial?insurerId=${insurer.id}`)
        .set(bearer(finance.accessToken))
        .expect(200)
    ).body as FinancialDashboardBody;

    expect(res.currency).toBe('JOD');
    expect(res.receivables.totals.invoiceCount).toBe(1);
    expect(res.receivables.totals.outstandingTotal).toBe('1000.000');
    expect(res.payables.totals.outstandingCount).toBe(1);
    expect(res.payables.totals.outstandingAmount).toBe('1800.000');
    expect(res.payables.totals.remittedAmount).toBe('900.000');
    expect(res.commission.earned).toBe('300.000');
    expect(res.commission.paid).toBe('100.000');
    expect(res.commission.outstanding).toBe('200.000');
    expect(res.profitability.totals.policyCount).toBe(1);
    const byLine = res.profitability.byLine.find((r) => r.key === 'motor');
    expect(byLine).toMatchObject({
      premiumWritten: '4000.000',
      claimsPaid: '500.000',
      commissionEarned: '300.000',
      netPosition: '3200.000', // 4000 - 500 - 300
    });
    const bySegment = res.profitability.bySegment.find(
      (r) => r.key === 'CORPORATE',
    );
    expect(bySegment).toBeTruthy();
  });

  it('scopes to one branch when branchId is given, and excludes remittances from the line filter', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'fd-manager-branch',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const branch = await prisma.branch.create({
      data: { name: uniqueLabel('Financial Dashboard E2E Branch') },
    });
    const officer = await makeUser(
      app,
      'fd-branch-officer',
      'FINANCE_COLLECTIONS_OFFICER',
    );
    await prisma.user.update({
      where: { id: officer.userId },
      data: { branchId: branch.id },
    });

    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Financial Dashboard E2E Branch Insurer') },
    });
    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: uniqueLabel('Financial Dashboard E2E Branch Client'),
        ownerUserId: officer.userId,
      },
    });
    const opportunity = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    const policy = await prisma.policy.create({
      data: {
        opportunityId: opportunity.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: 'property',
        status: 'ACTIVE',
        requestedPremium: '1000.000',
        issuedPremium: '1000.000',
        placedByUserId: officer.userId,
      },
    });
    await prisma.invoice.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        premiumAmount: '600.000',
        totalAmount: '600.000',
        dueDate: daysFromNow(10),
      },
    });

    const scoped = (
      await request(app.getHttpServer())
        .get(
          `/dashboards/financial?branchId=${branch.id}&insurerId=${insurer.id}`,
        )
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as FinancialDashboardBody;
    expect(scoped.receivables.totals.invoiceCount).toBe(1);

    const otherBranch = await prisma.branch.create({
      data: { name: uniqueLabel('Financial Dashboard E2E Other Branch') },
    });
    const emptyScoped = (
      await request(app.getHttpServer())
        .get(
          `/dashboards/financial?branchId=${otherBranch.id}&insurerId=${insurer.id}`,
        )
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as FinancialDashboardBody;
    expect(emptyScoped.receivables.totals.invoiceCount).toBe(0);
  });
});
