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
interface PortfolioBreakdownRowBody {
  key: string;
  policyCount: number;
  totalIssuedPremiumJod: string;
}
interface PortfolioAnalysisSummaryBody {
  generatedAt: string;
  byLine: PortfolioBreakdownRowBody[];
  byInsurer: PortfolioBreakdownRowBody[];
  byClientSegment: PortfolioBreakdownRowBody[];
  byGeography: PortfolioBreakdownRowBody[];
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
      fullName: 'Portfolio Analysis E2E User',
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
  rows: PortfolioBreakdownRowBody[],
  key: string,
): PortfolioBreakdownRowBody | undefined {
  return rows.find((r) => r.key === key);
}

describe('Portfolio Analysis (e2e) — backlog Part C #62', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the summary behind portfolio-analysis.view', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'pa-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await request(app.getHttpServer())
      .get('/portfolio-analysis')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('breaks the real portfolio down by line, insurer, client segment, and geography', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'pa-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    // Uniquely-named fixtures so byLine/byInsurer/byGeography can be
    // asserted EXACTLY, even against db-test's cumulative book — only
    // byClientSegment (CORPORATE/INDIVIDUAL, a closed 2-value set shared by
    // the whole book) needs a before/after delta instead.
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Portfolio E2E Insurer') },
    });
    const branch = await prisma.branch.create({
      data: { name: uniqueLabel('Portfolio E2E Branch') },
    });
    const line = uniqueLabel('portfolio-e2e-line');

    const officer = await prisma.user.create({
      data: {
        fullName: 'Portfolio E2E Officer',
        email: uniqueEmail('pa-officer'),
        passwordHash: 'unused-scored-user',
        branchId: branch.id,
      },
    });

    const corpCustomer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Portfolio E2E Corp Co'),
        ownerUserId: officer.id,
      },
    });
    const indivCustomer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: 'Portfolio E2E Individual',
        ownerUserId: officer.id,
      },
    });

    const before = (
      await request(app.getHttpServer())
        .get('/portfolio-analysis')
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as PortfolioAnalysisSummaryBody;
    const corpBefore =
      findRow(before.byClientSegment, 'CORPORATE')?.policyCount ?? 0;
    const indivBefore =
      findRow(before.byClientSegment, 'INDIVIDUAL')?.policyCount ?? 0;

    const opportunity1 = await prisma.opportunity.create({
      data: { customerId: corpCustomer.id },
    });
    await prisma.policy.create({
      data: {
        opportunityId: opportunity1.id,
        customerId: corpCustomer.id,
        insurerId: insurer.id,
        insuranceLine: line,
        requestedPremium: '1000.000',
        issuedPremium: '1000.000',
      },
    });
    const opportunity2 = await prisma.opportunity.create({
      data: { customerId: indivCustomer.id },
    });
    await prisma.policy.create({
      data: {
        opportunityId: opportunity2.id,
        customerId: indivCustomer.id,
        insurerId: insurer.id,
        insuranceLine: line,
        requestedPremium: '2000.000',
        issuedPremium: '2000.000',
      },
    });

    const after = (
      await request(app.getHttpServer())
        .get('/portfolio-analysis')
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as PortfolioAnalysisSummaryBody;

    const lineRow = findRow(after.byLine, line);
    expect(lineRow).toEqual({
      key: line,
      policyCount: 2,
      totalIssuedPremiumJod: '3000.000',
    });

    const insurerRow = findRow(after.byInsurer, insurer.name);
    expect(insurerRow).toEqual({
      key: insurer.name,
      policyCount: 2,
      totalIssuedPremiumJod: '3000.000',
    });

    const geographyRow = findRow(after.byGeography, branch.name);
    expect(geographyRow).toEqual({
      key: branch.name,
      policyCount: 2,
      totalIssuedPremiumJod: '3000.000',
    });

    const corpAfter = findRow(after.byClientSegment, 'CORPORATE');
    const indivAfter = findRow(after.byClientSegment, 'INDIVIDUAL');
    expect(corpAfter?.policyCount).toBe(corpBefore + 1);
    expect(indivAfter?.policyCount).toBe(indivBefore + 1);
  });
});
