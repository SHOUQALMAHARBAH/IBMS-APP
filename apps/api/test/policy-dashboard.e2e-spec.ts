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
interface PolicyDashboardBody {
  periodLabel: string;
  renewalWindowDays: number;
  activePoliciesCount: number;
  expiringPoliciesCount: number;
  newPoliciesIssuedCount: number;
  cancelledPolicies: {
    policyId: string;
    policyNumber: string | null;
    insuranceLine: string;
    reason: string;
    cancelledAt: string;
  }[];
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
    .send({ fullName: 'Policy Dashboard E2E User', email, password: PASSWORD })
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
// (db-test is cumulative) — isolates this test's counts.
const PERIOD_LABEL = '2018-05';
const PERIOD_START = '2018-05-01';
const PERIOD_END = '2018-06-01';
const IN_PERIOD = new Date('2018-05-15T00:00:00.000Z');

describe('Policy Dashboard (e2e) — backlog Part E / Process #64', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the summary behind dashboard.policy.view', async () => {
    const app = await boot();
    const outsider = await makeUser(app, 'pd-outsider', 'CLAIMS_OFFICER');
    await request(app.getHttpServer())
      .get('/dashboards/policy')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('422s a partial period override', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'pd-placement-partial',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/dashboards/policy?periodLabel=2018-05')
      .set(bearer(placement.accessToken))
      .expect(422);
  });

  it('computes active/expiring/newly-issued/cancelled policies, expiring using a live now-based window regardless of the period filter', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'pd-placement-walk',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Policy Dashboard E2E Co'),
        ownerUserId: placement.userId,
      },
    });
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Policy Dashboard E2E Insurer') },
    });

    // Active policy.
    const activeOpportunity = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    await prisma.policy.create({
      data: {
        opportunityId: activeOpportunity.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: 'property',
        status: 'ACTIVE',
        requestedPremium: '1000.000',
        issuedPremium: '1000.000',
        placedByUserId: placement.userId,
      },
    });

    // Expiring-soon active policy (within the default 90-day window).
    const expiringOpportunity = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await prisma.policy.create({
      data: {
        opportunityId: expiringOpportunity.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: 'property',
        status: 'ACTIVE',
        expiryDate: soon,
        requestedPremium: '1000.000',
        issuedPremium: '1000.000',
        placedByUserId: placement.userId,
      },
    });

    // Newly-issued policy in the historical period.
    const issuedOpportunity = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    await prisma.policy.create({
      data: {
        opportunityId: issuedOpportunity.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: 'property',
        requestedPremium: '2000.000',
        issuedPremium: '2000.000',
        placedByUserId: placement.userId,
        createdAt: IN_PERIOD,
      },
    });

    // Cancelled policy, applied within the historical period.
    const cancelOpportunity = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    const cancelledPolicy = await prisma.policy.create({
      data: {
        opportunityId: cancelOpportunity.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: 'motor',
        status: 'CANCELLED',
        requestedPremium: '500.000',
        issuedPremium: '500.000',
        placedByUserId: placement.userId,
      },
    });
    const cancelEndorsement = await prisma.endorsement.create({
      data: {
        policyId: cancelledPolicy.id,
        type: 'NEGATIVE',
        changeType: 'cancellation',
        status: 'APPLIED',
        premiumAdjustment: '-500.000',
        requestedByUserId: placement.userId,
        appliedAt: IN_PERIOD,
      },
    });
    await prisma.cancellation.create({
      data: {
        endorsementId: cancelEndorsement.id,
        reason: uniqueLabel('Client sold the insured vehicle'),
        basis: 'pro_rata',
        returnPremium: '250.000',
      },
    });

    const res = (
      await request(app.getHttpServer())
        .get(
          `/dashboards/policy?periodLabel=${PERIOD_LABEL}&periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`,
        )
        .set(bearer(placement.accessToken))
        .expect(200)
    ).body as PolicyDashboardBody;

    expect(res.periodLabel).toBe(PERIOD_LABEL);
    expect(res.renewalWindowDays).toBe(90);
    expect(res.activePoliciesCount).toBeGreaterThanOrEqual(2); // active + expiring-soon
    expect(res.expiringPoliciesCount).toBeGreaterThanOrEqual(1);
    expect(res.newPoliciesIssuedCount).toBeGreaterThanOrEqual(1);
    const cancelledRow = res.cancelledPolicies.find(
      (c) => c.policyId === cancelledPolicy.id,
    );
    expect(cancelledRow).toBeTruthy();
    expect(cancelledRow?.reason).toContain('Client sold the insured vehicle');
  });

  it('honors a caller-supplied renewalWindowDays for the expiring-policies count', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'pd-manager-window',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Policy Dashboard E2E Window Co'),
        ownerUserId: manager.userId,
      },
    });
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Policy Dashboard E2E Window Insurer') },
    });
    const opportunity = await prisma.opportunity.create({
      data: { customerId: customer.id },
    });
    const in45Days = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    await prisma.policy.create({
      data: {
        opportunityId: opportunity.id,
        customerId: customer.id,
        insurerId: insurer.id,
        insuranceLine: 'property',
        status: 'ACTIVE',
        expiryDate: in45Days,
        requestedPremium: '1000.000',
        issuedPremium: '1000.000',
      },
    });

    const narrow = (
      await request(app.getHttpServer())
        .get('/dashboards/policy?renewalWindowDays=30')
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as PolicyDashboardBody;
    const wide = (
      await request(app.getHttpServer())
        .get('/dashboards/policy?renewalWindowDays=60')
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as PolicyDashboardBody;

    expect(narrow.renewalWindowDays).toBe(30);
    expect(wide.renewalWindowDays).toBe(60);
    expect(wide.expiringPoliciesCount).toBeGreaterThan(
      narrow.expiringPoliciesCount,
    );
  });
});
