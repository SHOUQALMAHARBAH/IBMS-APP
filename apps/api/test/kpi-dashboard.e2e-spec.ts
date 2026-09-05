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
interface KpiDashboardSummaryBody {
  generatedAt: string;
  sales: {
    totalCustomers: number;
    leadsByStatus: Record<string, number>;
    prospectsByStatus: Record<string, number>;
    opportunitiesByStatus: Record<string, number>;
  };
  policy: {
    policiesByStatus: Record<string, number>;
    totalIssuedPremiumJod: string;
  };
  claims: { claimsByStatus: Record<string, number> };
  finance: {
    outstandingInvoicedJod: string;
    invoicesByStatus: Record<string, number>;
    commissionThisMonthJod: string;
  };
  customerService: {
    complaintsByStatus: Record<string, number>;
    openServiceRequests: number;
  };
  complianceRisk: {
    openRiskRegisterItems: number;
    openIncidents: number;
    openInternalAuditFindings: number;
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
    .send({ fullName: 'KPI Dashboard E2E User', email, password: PASSWORD })
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

describe('General KPI Dashboard (e2e) — backlog Part C #58', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the summary behind kpi-dashboard.view and returns the full aggregate shape', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'kpi-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const outsider = await makeUser(
      app,
      'kpi-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await request(app.getHttpServer())
      .get('/kpi-dashboard')
      .set(bearer(outsider.accessToken))
      .expect(403);

    const res = await request(app.getHttpServer())
      .get('/kpi-dashboard')
      .set(bearer(manager.accessToken))
      .expect(200);
    const body = res.body as KpiDashboardSummaryBody;

    expect(typeof body.generatedAt).toBe('string');
    expect(typeof body.sales.totalCustomers).toBe('number');
    expect(body.policy.totalIssuedPremiumJod).toMatch(/^\d+\.\d{3}$/);
    expect(body.finance.outstandingInvoicedJod).toMatch(/^\d+\.\d{3}$/);
    expect(body.finance.commissionThisMonthJod).toMatch(/^\d+\.\d{3}$/);
    expect(typeof body.customerService.openServiceRequests).toBe('number');
    expect(typeof body.complianceRisk.openRiskRegisterItems).toBe('number');
    expect(typeof body.complianceRisk.openIncidents).toBe('number');
  });

  it("real writes move the dashboard's numbers — a fresh Lead and a fresh risk-register item each move their own bucket by exactly 1 (db-test is cumulative, so every assertion here is a BEFORE/AFTER delta, never a global count)", async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'kpi-manager2',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const sales = await makeUser(
      app,
      'kpi-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const before = (
      await request(app.getHttpServer())
        .get('/kpi-dashboard')
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as KpiDashboardSummaryBody;

    await request(app.getHttpServer())
      .post('/leads')
      .set(bearer(sales.accessToken))
      .send({
        fullName: 'KPI Dashboard E2E Lead',
        source: 'referral',
        marketingConsentGranted: false,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/risk-register')
      .set(bearer(manager.accessToken))
      .send({
        riskType: 'operational',
        description: 'A KPI-dashboard e2e fixture risk item.',
      })
      .expect(201);

    const after = (
      await request(app.getHttpServer())
        .get('/kpi-dashboard')
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as KpiDashboardSummaryBody;

    expect(after.sales.leadsByStatus.NEW ?? 0).toBe(
      (before.sales.leadsByStatus.NEW ?? 0) + 1,
    );
    expect(after.complianceRisk.openRiskRegisterItems).toBe(
      before.complianceRisk.openRiskRegisterItems + 1,
    );
  });
});
