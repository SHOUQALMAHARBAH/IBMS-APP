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

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface ClaimsDashboardBody {
  asOf: string;
  openClaimsCount: number;
  closedClaimsCount: number;
  outstandingClaimsValueJod: string;
  ageing: Record<string, { count: number; valueJod: string }>;
  lossRatioByClient: { key: string; label: string; ratio: string }[];
  lossRatioByLine: { key: string; label: string; ratio: string }[];
  lossRatioByInsurer: { key: string; label: string; ratio: string }[];
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
    .send({ fullName: 'Claims Dashboard E2E User', email, password: PASSWORD })
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

describe('Claims Dashboard (e2e) — backlog Part E / Process #64', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the summary behind dashboard.claims.view', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'cd-outsider',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/dashboards/claims')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('400s a malformed asOf', async () => {
    const app = await boot();
    const claims = await makeUser(app, 'cd-claims-bad-date', 'CLAIMS_OFFICER');
    await request(app.getHttpServer())
      .get('/dashboards/claims?asOf=not-a-date')
      .set(bearer(claims.accessToken))
      .expect(400);
  });

  it('422s a future asOf', async () => {
    const app = await boot();
    const claims = await makeUser(
      app,
      'cd-claims-future-date',
      'CLAIMS_OFFICER',
    );
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await request(app.getHttpServer())
      .get(`/dashboards/claims?asOf=${future}`)
      .set(bearer(claims.accessToken))
      .expect(422);
  });

  it('computes open/closed counts, outstanding value, ageing buckets, and loss ratio by client/line/insurer', async () => {
    const app = await boot();
    const claims = await makeUser(app, 'cd-claims-walk', 'CLAIMS_OFFICER');
    // A fresh Insurer isolates this test's figures from db-test's cumulative
    // history — there is no lower bound on `createdAt` for this dashboard
    // (unlike a period-range filter), so a historical date window alone
    // cannot isolate; insurerId scoping does.
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Claims Dashboard E2E Insurer') },
    });
    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Claims Dashboard E2E Co'),
        ownerUserId: claims.userId,
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
        requestedPremium: '40000.000',
        issuedPremium: '40000.000',
        placedByUserId: claims.userId,
      },
    });

    // Open claim, no settlement yet -> outstanding value uses estimatedLoss,
    // 10 days open -> bucket d0_30.
    await prisma.claim.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        status: 'UNDER_ASSESSMENT',
        lossDate: daysAgo(12),
        estimatedLoss: '1000.000',
        createdAt: daysAgo(10),
      },
    });

    // Open claim, SETTLED but not yet CLOSED -> outstanding value uses
    // netSettlement (4200), 45 days open -> bucket d31_60.
    const settledOpenClaim = await prisma.claim.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        status: 'SETTLED',
        lossDate: daysAgo(50),
        estimatedLoss: '5000.000',
        createdAt: daysAgo(45),
      },
    });
    await prisma.settlement.create({
      data: {
        claimId: settledOpenClaim.id,
        estimatedLoss: '5000.000',
        approvedAmount: '4200.000',
        deductible: '0.000',
        netSettlement: '4200.000',
      },
    });

    // Open claim, 100 days open -> bucket d90_plus.
    await prisma.claim.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        status: 'DOCUMENTATION_IN_PROGRESS',
        lossDate: daysAgo(105),
        estimatedLoss: '300.000',
        createdAt: daysAgo(100),
      },
    });

    // Closed claim, contributes to the loss-ratio breakdown. computeLossRatio
    // sums every SETTLED/CLOSED claim's net settlement (not just CLOSED), so
    // this stacks with the SETTLED-open claim above: (20000 + 4200) / 40000
    // premium -> ratio 0.6050.
    const closedClaim = await prisma.claim.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        status: 'CLOSED',
        lossDate: daysAgo(200),
        estimatedLoss: '20000.000',
        createdAt: daysAgo(190),
      },
    });
    await prisma.settlement.create({
      data: {
        claimId: closedClaim.id,
        estimatedLoss: '20000.000',
        approvedAmount: '20000.000',
        deductible: '0.000',
        netSettlement: '20000.000',
      },
    });

    const res = (
      await request(app.getHttpServer())
        .get(`/dashboards/claims?insurerId=${insurer.id}`)
        .set(bearer(claims.accessToken))
        .expect(200)
    ).body as ClaimsDashboardBody;

    expect(res.openClaimsCount).toBe(3);
    expect(res.closedClaimsCount).toBe(1);
    expect(res.outstandingClaimsValueJod).toBe('5500.000'); // 1000 + 4200 + 300
    expect(res.ageing.d0_30).toEqual({ count: 1, valueJod: '1000.000' });
    expect(res.ageing.d31_60).toEqual({ count: 1, valueJod: '4200.000' });
    expect(res.ageing.d61_90).toEqual({ count: 0, valueJod: '0.000' });
    expect(res.ageing.d90_plus).toEqual({ count: 1, valueJod: '300.000' });

    const byClient = res.lossRatioByClient.find((r) => r.key === customer.id);
    expect(byClient).toMatchObject({ ratio: '0.6050' });
    const byLine = res.lossRatioByLine.find((r) => r.key === 'motor');
    expect(byLine).toMatchObject({ ratio: '0.6050' });
    const byInsurer = res.lossRatioByInsurer.find((r) => r.key === insurer.id);
    expect(byInsurer).toMatchObject({ label: insurer.name, ratio: '0.6050' });
  });

  it('scopes to one branch when branchId is given', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'cd-manager-branch',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const branch = await prisma.branch.create({
      data: { name: uniqueLabel('Claims Dashboard E2E Branch') },
    });
    const officer = await makeUser(app, 'cd-branch-officer', 'CLAIMS_OFFICER');
    await prisma.user.update({
      where: { id: officer.userId },
      data: { branchId: branch.id },
    });

    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Claims Dashboard E2E Branch Insurer') },
    });
    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Claims Dashboard E2E Branch Co'),
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
        requestedPremium: '10000.000',
        issuedPremium: '10000.000',
        placedByUserId: officer.userId,
      },
    });
    await prisma.claim.create({
      data: {
        policyId: policy.id,
        customerId: customer.id,
        status: 'UNDER_ASSESSMENT',
        lossDate: daysAgo(5),
        estimatedLoss: '500.000',
        createdAt: daysAgo(3),
      },
    });

    const scoped = (
      await request(app.getHttpServer())
        .get(`/dashboards/claims?branchId=${branch.id}&insurerId=${insurer.id}`)
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as ClaimsDashboardBody;
    expect(scoped.openClaimsCount).toBe(1);

    const otherBranch = await prisma.branch.create({
      data: { name: uniqueLabel('Claims Dashboard E2E Other Branch') },
    });
    const emptyScoped = (
      await request(app.getHttpServer())
        .get(
          `/dashboards/claims?branchId=${otherBranch.id}&insurerId=${insurer.id}`,
        )
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as ClaimsDashboardBody;
    expect(emptyScoped.openClaimsCount).toBe(0);
  });
});
