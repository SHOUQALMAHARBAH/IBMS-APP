import { randomUUID } from 'node:crypto';
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
interface SalesTargetBody {
  id: string;
  ownerUserId: string | null;
  branchId: string | null;
  periodLabel: string;
  targetNewProspects: number;
}
interface SalesPerformanceBody {
  scope: { ownerUserId: string } | { branchId: string };
  target: SalesTargetBody | null;
  actual: { newLeads: number; newProspects: number } | null;
  achievementPercent: number | null;
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
    .send({ fullName: 'Sales Performance E2E User', email, password: PASSWORD })
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

/** A window guaranteed to contain "now" — Process 59's "current" resolution
 * needs a real, unpredictable-length test run to still land inside it. */
function currentWindow(): { periodStart: string; periodEnd: string } {
  return { periodStart: '2020-01-01', periodEnd: '2035-01-01' };
}

describe('Sales Performance (e2e) — backlog Part C #59', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates target management behind sales-target.manage and the performance read behind dashboard.sales.view', async () => {
    const app = await boot();
    const outsider = await makeUser(app, 'sp-outsider', 'CLAIMS_OFFICER');

    await request(app.getHttpServer())
      .post('/sales-targets')
      .set(bearer(outsider.accessToken))
      .send({
        ownerUserId: outsider.userId,
        periodLabel: uniqueLabel('period'),
        ...currentWindow(),
        targetNewProspects: 5,
      })
      .expect(403);

    await request(app.getHttpServer())
      .get('/sales-performance')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('rejects a target with both or neither of ownerUserId/branchId', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'sp-manager-bad',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    await request(app.getHttpServer())
      .post('/sales-targets')
      .set(bearer(manager.accessToken))
      .send({
        ownerUserId: manager.userId,
        branchId: randomUUID(),
        periodLabel: uniqueLabel('period'),
        ...currentWindow(),
        targetNewProspects: 5,
      })
      .expect(422);

    await request(app.getHttpServer())
      .post('/sales-targets')
      .set(bearer(manager.accessToken))
      .send({
        periodLabel: uniqueLabel('period'),
        ...currentWindow(),
        targetNewProspects: 5,
      })
      .expect(422);
  });

  it('409s a duplicate target for the same owner+period, and PATCH revises the figure', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'sp-manager-dup',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const officer = await makeUser(
      app,
      'sp-officer-dup',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const periodLabel = uniqueLabel('period');

    const created = await request(app.getHttpServer())
      .post('/sales-targets')
      .set(bearer(manager.accessToken))
      .send({
        ownerUserId: officer.userId,
        periodLabel,
        ...currentWindow(),
        targetNewProspects: 8,
      })
      .expect(201);
    const target = created.body as SalesTargetBody;

    await request(app.getHttpServer())
      .post('/sales-targets')
      .set(bearer(manager.accessToken))
      .send({
        ownerUserId: officer.userId,
        periodLabel,
        ...currentWindow(),
        targetNewProspects: 3,
      })
      .expect(409);

    const patched = await request(app.getHttpServer())
      .patch(`/sales-targets/${target.id}`)
      .set(bearer(manager.accessToken))
      .send({ targetNewProspects: 12 })
      .expect(200);
    expect((patched.body as SalesTargetBody).targetNewProspects).toBe(12);
  });

  it('scopes a Sales Officer to their own performance regardless of ownerUserId, and forbids a branch view', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'sp-manager-scope',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const officer = await makeUser(
      app,
      'sp-officer-scope',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const someoneElse = await makeUser(
      app,
      'sp-other-scope',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await request(app.getHttpServer())
      .post('/sales-targets')
      .set(bearer(manager.accessToken))
      .send({
        ownerUserId: officer.userId,
        periodLabel: uniqueLabel('period'),
        ...currentWindow(),
        targetNewProspects: 6,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/sales-performance')
      .query({ ownerUserId: someoneElse.userId })
      .set(bearer(officer.accessToken))
      .expect(200);
    const body = res.body as SalesPerformanceBody;
    expect(body.scope).toEqual({ ownerUserId: officer.userId });

    await request(app.getHttpServer())
      .get('/sales-performance')
      .query({ branchId: randomUUID() })
      .set(bearer(officer.accessToken))
      .expect(403);
  });

  it('reports null target/actual when no target covers "now", and 404s an explicit unknown periodLabel', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'sp-manager-none',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const officer = await makeUser(
      app,
      'sp-officer-none',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const res = await request(app.getHttpServer())
      .get('/sales-performance')
      .query({ ownerUserId: officer.userId })
      .set(bearer(manager.accessToken))
      .expect(200);
    const body = res.body as SalesPerformanceBody;
    expect(body.target).toBeNull();
    expect(body.actual).toBeNull();
    expect(body.achievementPercent).toBeNull();

    await request(app.getHttpServer())
      .get('/sales-performance')
      .query({ ownerUserId: officer.userId, periodLabel: 'no-such-period' })
      .set(bearer(manager.accessToken))
      .expect(404);
  });

  it('real writes move the achievement figure — a fresh Lead qualified into a Prospect moves newProspects from 0 to 1 for a brand-new officer', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'sp-manager-flow',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const officer = await makeUser(
      app,
      'sp-officer-flow',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await request(app.getHttpServer())
      .post('/sales-targets')
      .set(bearer(manager.accessToken))
      .send({
        ownerUserId: officer.userId,
        periodLabel: uniqueLabel('period'),
        ...currentWindow(),
        targetNewProspects: 2,
      })
      .expect(201);

    const before = (
      await request(app.getHttpServer())
        .get('/sales-performance')
        .set(bearer(officer.accessToken))
        .expect(200)
    ).body as SalesPerformanceBody;
    expect(before.actual).toEqual({ newLeads: 0, newProspects: 0 });
    expect(before.achievementPercent).toBe(0);

    const lead = await request(app.getHttpServer())
      .post('/leads')
      .set(bearer(officer.accessToken))
      .send({
        fullName: 'Sales Performance E2E Lead',
        source: 'referral',
        marketingConsentGranted: false,
      })
      .expect(201);
    const leadId = (lead.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/leads/${leadId}/transition`)
      .set(bearer(officer.accessToken))
      .send({ toStatus: 'CONTACTED' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/leads/${leadId}/transition`)
      .set(bearer(officer.accessToken))
      .send({ toStatus: 'QUALIFIED' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/prospects')
      .set(bearer(officer.accessToken))
      .send({ leadId, companyName: 'Sales Performance E2E Co' })
      .expect(201);

    const after = (
      await request(app.getHttpServer())
        .get('/sales-performance')
        .set(bearer(officer.accessToken))
        .expect(200)
    ).body as SalesPerformanceBody;
    expect(after.actual).toEqual({ newLeads: 1, newProspects: 1 });
    expect(after.achievementPercent).toBe(50);
  });

  it('resolves a branch scope to every user in that branch', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'sp-manager-branch',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const officerA = await makeUser(
      app,
      'sp-officer-branch-a',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const officerB = await makeUser(
      app,
      'sp-officer-branch-b',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const branch = await prisma.branch.create({
      data: { name: uniqueLabel('Amman Branch') },
    });
    await prisma.user.update({
      where: { id: officerA.userId },
      data: { branchId: branch.id },
    });
    await prisma.user.update({
      where: { id: officerB.userId },
      data: { branchId: branch.id },
    });

    await request(app.getHttpServer())
      .post('/sales-targets')
      .set(bearer(manager.accessToken))
      .send({
        branchId: branch.id,
        periodLabel: uniqueLabel('period'),
        ...currentWindow(),
        targetNewProspects: 4,
      })
      .expect(201);

    for (const officer of [officerA, officerB]) {
      const lead = await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(officer.accessToken))
        .send({
          fullName: 'Sales Performance E2E Branch Lead',
          source: 'referral',
          marketingConsentGranted: false,
        })
        .expect(201);
      const leadId = (lead.body as { id: string }).id;
      await request(app.getHttpServer())
        .post(`/leads/${leadId}/transition`)
        .set(bearer(officer.accessToken))
        .send({ toStatus: 'CONTACTED' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/leads/${leadId}/transition`)
        .set(bearer(officer.accessToken))
        .send({ toStatus: 'QUALIFIED' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/prospects')
        .set(bearer(officer.accessToken))
        .send({ leadId, companyName: 'Sales Performance E2E Branch Co' })
        .expect(201);
    }

    const res = await request(app.getHttpServer())
      .get('/sales-performance')
      .query({ branchId: branch.id })
      .set(bearer(manager.accessToken))
      .expect(200);
    const body = res.body as SalesPerformanceBody;
    expect(body.actual).toEqual({ newLeads: 2, newProspects: 2 });
    expect(body.achievementPercent).toBe(50);
  });
});
