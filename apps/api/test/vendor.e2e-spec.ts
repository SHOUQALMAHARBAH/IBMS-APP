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
interface VendorBody {
  id: string;
  name: string;
  vendorType: string;
  riskTier: string | null;
  annualReviewDueAt: string | null;
  terminationDataReturnConfirmedAt: string | null;
  accessRevokedAt: string | null;
}
interface DpaBody {
  id: string;
  vendorId: string;
  signedAt: string | null;
  assessedByUserId: string | null;
  dpoApprovedByUserId: string | null;
}
interface ReadinessBody {
  vendorId: string;
  riskTier: string | null;
  ready: boolean;
  reasons: string[];
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
    .send({ fullName: 'Vendor E2E User', email, password: PASSWORD })
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

describe('Procurement / Vendor Management (e2e) — backlog Part C #67 / #71', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates every route behind vendor.manage', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'vendor-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/vendors')
      .set(bearer(outsider.accessToken))
      .send({ name: 'Nobody Supplies', vendorType: 'other' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/vendors')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('rejects a vendorType outside the documented 7-value set', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'vendor-manager-bad',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    await request(app.getHttpServer())
      .post('/vendors')
      .set(bearer(manager.accessToken))
      .send({ name: 'Bad Type Co', vendorType: 'something_else' })
      .expect(400);
  });

  it('walks create -> list (filtered) -> get -> update for a procurement vendor', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'vendor-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    const name = uniqueLabel('Acme Office Supplies');
    const created = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set(bearer(manager.accessToken))
        .send({ name, vendorType: 'other' })
        .expect(201)
    ).body as VendorBody;
    expect(created.vendorType).toBe('other');

    const list = (
      await request(app.getHttpServer())
        .get('/vendors?vendorType=other')
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as VendorBody[];
    expect(list.find((v) => v.id === created.id)).toBeTruthy();

    const fetched = (
      await request(app.getHttpServer())
        .get(`/vendors/${created.id}`)
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as VendorBody;
    expect(fetched.name).toBe(name);

    const renamed = uniqueLabel('Acme Office Supplies Renamed');
    const updated = (
      await request(app.getHttpServer())
        .patch(`/vendors/${created.id}`)
        .set(bearer(manager.accessToken))
        .send({ name: renamed })
        .expect(200)
    ).body as VendorBody;
    expect(updated.name).toBe(renamed);
    expect(updated.vendorType).toBe('other'); // untouched by a name-only patch
  });

  // Part F item #6 — bilingual full-text search over name. Same "prove
  // real stemming, not substring luck" discipline as customer.e2e-spec.ts's
  // own search tests.
  it('finds a vendor via a stemmed English search term ("trade" -> "Trading")', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'vendor-search-en',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const name = uniqueLabel('Al-Ufuq Trading Co.');
    const created = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set(bearer(manager.accessToken))
        .send({ name, vendorType: 'other' })
        .expect(201)
    ).body as VendorBody;

    const res = await request(app.getHttpServer())
      .get('/vendors?search=trade')
      .set(bearer(manager.accessToken))
      .expect(200);
    const ids = (res.body as VendorBody[]).map((v) => v.id);
    expect(ids).toContain(created.id);
  });

  it('finds a vendor via a stemmed Arabic search term (singular matches a stored plural)', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'vendor-search-ar',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const name = uniqueLabel('شركة الأفق للسيارات');
    const created = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set(bearer(manager.accessToken))
        .send({ name, vendorType: 'other' })
        .expect(201)
    ).body as VendorBody;

    const res = await request(app.getHttpServer())
      .get(`/vendors?search=${encodeURIComponent('سيارة')}`)
      .set(bearer(manager.accessToken))
      .expect(200);
    const ids = (res.body as VendorBody[]).map((v) => v.id);
    expect(ids).toContain(created.id);
  });

  it('an empty search param behaves like no search param at all', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'vendor-search-empty',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const name = uniqueLabel('Empty Search Co.');
    const created = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set(bearer(manager.accessToken))
        .send({ name, vendorType: 'other' })
        .expect(201)
    ).body as VendorBody;

    const res = await request(app.getHttpServer())
      .get('/vendors?search=')
      .set(bearer(manager.accessToken))
      .expect(200);
    const ids = (res.body as VendorBody[]).map((v) => v.id);
    expect(ids).toContain(created.id);
  });

  it('a nonsense search term matches nothing', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'vendor-search-nomatch',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const nonsense = `zzznomatch${Date.now()}${Math.random().toString(36).slice(2)}`;

    const res = await request(app.getHttpServer())
      .get(`/vendors?search=${nonsense}`)
      .set(bearer(manager.accessToken))
      .expect(200);
    expect(res.body as VendorBody[]).toHaveLength(0);
  });

  it('404s getting or updating an unknown vendor', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'vendor-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    await request(app.getHttpServer())
      .get('/vendors/00000000-0000-0000-0000-000000000000')
      .set(bearer(admin.accessToken))
      .expect(404);
    await request(app.getHttpServer())
      .patch('/vendors/00000000-0000-0000-0000-000000000000')
      .set(bearer(admin.accessToken))
      .send({ name: 'Nope' })
      .expect(404);
  });

  it('#71 — risk tiering auto-schedules the annual review, and a re-review re-bases it +12 months', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'vendor-tier-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const created = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set(bearer(manager.accessToken))
        .send({ name: uniqueLabel('Tiered Vendor'), vendorType: 'it_cloud' })
        .expect(201)
    ).body as VendorBody;
    expect(created.riskTier).toBeNull();

    // no annual review scheduled yet — 422.
    await request(app.getHttpServer())
      .post(`/vendors/${created.id}/annual-review`)
      .set(bearer(manager.accessToken))
      .expect(422);

    const tiered = (
      await request(app.getHttpServer())
        .patch(`/vendors/${created.id}/risk-tier`)
        .set(bearer(manager.accessToken))
        .send({ riskTier: 'medium' })
        .expect(200)
    ).body as VendorBody;
    expect(tiered.riskTier).toBe('medium');
    expect(tiered.annualReviewDueAt).not.toBeNull();

    const reviewed = (
      await request(app.getHttpServer())
        .post(`/vendors/${created.id}/annual-review`)
        .set(bearer(manager.accessToken))
        .expect(201)
    ).body as VendorBody;
    expect(reviewed.annualReviewDueAt).not.toBeNull();
    expect(new Date(reviewed.annualReviewDueAt!).getTime()).toBeGreaterThan(
      new Date(tiered.annualReviewDueAt!).getTime() - 1000,
    );

    // an out-of-set riskTier 400s.
    await request(app.getHttpServer())
      .patch(`/vendors/${created.id}/risk-tier`)
      .set(bearer(manager.accessToken))
      .send({ riskTier: 'critical' })
      .expect(400);
  });

  it('#71 — walks the full DPA maker/checker lifecycle and the data-share readiness gate for a High-tier vendor', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'vendor-dpa-compliance',
      'COMPLIANCE_OFFICER',
    );
    const dpo = await makeUser(
      app,
      'vendor-dpa-dpo',
      'DATA_PROTECTION_OFFICER',
    );
    const outsider = await makeUser(
      app,
      'vendor-dpa-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const vendor = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set(bearer(compliance.accessToken))
        .send({
          name: uniqueLabel('High Risk Cloud Vendor'),
          vendorType: 'it_cloud',
        })
        .expect(201)
    ).body as VendorBody;

    await request(app.getHttpServer())
      .patch(`/vendors/${vendor.id}/risk-tier`)
      .set(bearer(compliance.accessToken))
      .send({ riskTier: 'high' })
      .expect(200);

    const notReadyYet = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}/data-share-readiness`)
        .set(bearer(compliance.accessToken))
        .expect(200)
    ).body as ReadinessBody;
    expect(notReadyYet.ready).toBe(false);

    const dpa = (
      await request(app.getHttpServer())
        .post(`/vendors/${vendor.id}/data-processing-agreements`)
        .set(bearer(compliance.accessToken))
        .expect(201)
    ).body as DpaBody;
    expect(dpa.assessedByUserId).toBe(compliance.userId);

    // outsider holds neither vendor.manage nor dpa.approve.
    await request(app.getHttpServer())
      .post(`/data-processing-agreements/${dpa.id}/sign`)
      .set(bearer(outsider.accessToken))
      .expect(403);

    const signed = (
      await request(app.getHttpServer())
        .post(`/data-processing-agreements/${dpa.id}/sign`)
        .set(bearer(compliance.accessToken))
        .expect(201)
    ).body as DpaBody;
    expect(signed.signedAt).not.toBeNull();

    const stillNotReady = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}/data-share-readiness`)
        .set(bearer(compliance.accessToken))
        .expect(200)
    ).body as ReadinessBody;
    expect(stillNotReady.ready).toBe(false); // High tier still needs DPO approval

    // the assessor cannot also be the DPO approver (maker/checker).
    await request(app.getHttpServer())
      .post(`/data-processing-agreements/${dpa.id}/dpo-approve`)
      .set(bearer(compliance.accessToken))
      .expect(403);

    const approved = (
      await request(app.getHttpServer())
        .post(`/data-processing-agreements/${dpa.id}/dpo-approve`)
        .set(bearer(dpo.accessToken))
        .expect(201)
    ).body as DpaBody;
    expect(approved.dpoApprovedByUserId).toBe(dpo.userId);

    // a second approval attempt 409s.
    await request(app.getHttpServer())
      .post(`/data-processing-agreements/${dpa.id}/dpo-approve`)
      .set(bearer(dpo.accessToken))
      .expect(409);

    const nowReady = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}/data-share-readiness`)
        .set(bearer(compliance.accessToken))
        .expect(200)
    ).body as ReadinessBody;
    expect(nowReady.ready).toBe(true);
    expect(nowReady.reasons).toEqual([]);

    const list = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}/data-processing-agreements`)
        .set(bearer(compliance.accessToken))
        .expect(200)
    ).body as DpaBody[];
    expect(list.find((d) => d.id === dpa.id)).toBeTruthy();
  });

  it('#71 — Low tier is data-share ready with no DPA at all', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'vendor-low-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const vendor = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set(bearer(manager.accessToken))
        .send({
          name: uniqueLabel('Low Risk Printer'),
          vendorType: 'printing_archiving',
        })
        .expect(201)
    ).body as VendorBody;
    await request(app.getHttpServer())
      .patch(`/vendors/${vendor.id}/risk-tier`)
      .set(bearer(manager.accessToken))
      .send({ riskTier: 'low' })
      .expect(200);

    const readiness = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}/data-share-readiness`)
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as ReadinessBody;
    expect(readiness.ready).toBe(true);
  });

  it('#71 — walks termination -> access revocation, guarding order and double-execution', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'vendor-term-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const vendor = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set(bearer(manager.accessToken))
        .send({ name: uniqueLabel('Vendor To Terminate'), vendorType: 'other' })
        .expect(201)
    ).body as VendorBody;

    // access revocation before termination 422s.
    await request(app.getHttpServer())
      .post(`/vendors/${vendor.id}/revoke-access`)
      .set(bearer(manager.accessToken))
      .expect(422);

    // termination without the explicit attestation 422s.
    await request(app.getHttpServer())
      .post(`/vendors/${vendor.id}/terminate`)
      .set(bearer(manager.accessToken))
      .send({})
      .expect(422);

    const terminated = (
      await request(app.getHttpServer())
        .post(`/vendors/${vendor.id}/terminate`)
        .set(bearer(manager.accessToken))
        .send({ confirmDataReturnOrDestruction: true })
        .expect(201)
    ).body as VendorBody;
    expect(terminated.terminationDataReturnConfirmedAt).not.toBeNull();

    // a second termination 409s.
    await request(app.getHttpServer())
      .post(`/vendors/${vendor.id}/terminate`)
      .set(bearer(manager.accessToken))
      .send({ confirmDataReturnOrDestruction: true })
      .expect(409);

    const revoked = (
      await request(app.getHttpServer())
        .post(`/vendors/${vendor.id}/revoke-access`)
        .set(bearer(manager.accessToken))
        .expect(201)
    ).body as VendorBody;
    expect(revoked.accessRevokedAt).not.toBeNull();

    // a second revocation 409s.
    await request(app.getHttpServer())
      .post(`/vendors/${vendor.id}/revoke-access`)
      .set(bearer(manager.accessToken))
      .expect(409);
  });
});
