import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
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
interface PrivacyNoticeBody {
  id: string;
  touchpoint: string;
  versionNumber: number;
  legallyReviewedAt: string | null;
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
    .send({ fullName: 'Privacy Notice E2E User', email, password: PASSWORD })
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
    const role = await ensureRole(roleName);
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

describe('Notices (e2e) — backlog Part D §5.1, Process #52', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates writes behind privacy-notice.publish and reads behind privacy-notice.read', async () => {
    const app = await boot();
    // A touchpoint role: holds read (it has to show the notice at intake),
    // never publish. This assertion changed deliberately when the read was
    // split out of `consent.manage` — listing used to 403 for this role, and
    // now must not.
    const touchpointRole = await makeUser(
      app,
      'notice-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/privacy-notices')
      .set(bearer(touchpointRole.accessToken))
      .send({ touchpoint: 'claims', textAr: 'x', textEn: 'x' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/privacy-notices')
      .set(bearer(touchpointRole.accessToken))
      .expect(200);

    // A role that stands in front of no data subject holds NEITHER, so the
    // read is genuinely gated rather than open to any authenticated user —
    // without this half, granting read to everyone would still pass.
    const unrelated = await makeUser(
      app,
      'notice-unrelated',
      'FINANCE_COLLECTIONS_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/privacy-notices')
      .set(bearer(unrelated.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .get('/privacy-notices/current?touchpoint=claims')
      .set(bearer(unrelated.accessToken))
      .expect(403);
  });

  it('rejects a touchpoint outside the documented 7-value set', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'notice-dpo-bad',
      'DATA_PROTECTION_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/privacy-notices')
      .set(bearer(dpo.accessToken))
      .send({ touchpoint: 'social_media', textAr: 'x', textEn: 'x' })
      .expect(400);
  });

  it('publishing a second version for the same touchpoint increments versionNumber, and current() returns the latest', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'notice-dpo-version',
      'DATA_PROTECTION_OFFICER',
    );

    // touchpoint is constrained to the 7 real values (no fresh-per-test
    // string possible) — db-test is cumulative, so assert relative version
    // deltas against whatever already exists for "claims", never an
    // absolute version number.
    const before = (
      await request(app.getHttpServer())
        .get('/privacy-notices/current?touchpoint=claims')
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as { notice: PrivacyNoticeBody | null };
    const beforeVersion = before.notice?.versionNumber ?? 0;

    const v1 = (
      await request(app.getHttpServer())
        .post('/privacy-notices')
        .set(bearer(dpo.accessToken))
        .send({
          touchpoint: 'claims',
          textAr: 'نص عربي',
          textEn: `Claims privacy notice v${beforeVersion + 1}`,
        })
        .expect(201)
    ).body as PrivacyNoticeBody;
    expect(v1.versionNumber).toBe(beforeVersion + 1);

    const v2 = (
      await request(app.getHttpServer())
        .post('/privacy-notices')
        .set(bearer(dpo.accessToken))
        .send({
          touchpoint: 'claims',
          textAr: 'نص عربي محدث',
          textEn: `Claims privacy notice v${beforeVersion + 2}`,
        })
        .expect(201)
    ).body as PrivacyNoticeBody;
    expect(v2.versionNumber).toBe(beforeVersion + 2);

    const current = (
      await request(app.getHttpServer())
        .get('/privacy-notices/current?touchpoint=claims')
        .set(bearer(dpo.accessToken))
        .expect(200)
    ).body as { notice: PrivacyNoticeBody };
    expect(current.notice.id).toBe(v2.id);
  });

  it('current() returns { notice: null } for a touchpoint never published', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'notice-dpo-nonecurrent',
      'DATA_PROTECTION_OFFICER',
    );
    const res = await request(app.getHttpServer())
      .get('/privacy-notices/current?touchpoint=group_medical_life_motor_fleet')
      .set(bearer(dpo.accessToken))
      .expect(200);
    expect((res.body as { notice: unknown }).notice).toBeNull();
  });

  it('current() is reachable by a touchpoint role via privacy-notice.read', async () => {
    const app = await boot();
    const sales = await makeUser(
      app,
      'notice-sales-current',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/privacy-notices/current?touchpoint=onboarding_kyc')
      .set(bearer(sales.accessToken))
      .expect(200);
  });

  it('records a legal review, and rejects a second one', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'notice-dpo-legalreview',
      'DATA_PROTECTION_OFFICER',
    );

    const created = (
      await request(app.getHttpServer())
        .post('/privacy-notices')
        .set(bearer(dpo.accessToken))
        .send({
          touchpoint: 'rfq_market_placement',
          textAr: 'نص',
          textEn: 'RFQ market placement notice.',
        })
        .expect(201)
    ).body as PrivacyNoticeBody;
    expect(created.legallyReviewedAt).toBeNull();

    const reviewed = (
      await request(app.getHttpServer())
        .post(`/privacy-notices/${created.id}/legal-review`)
        .set(bearer(dpo.accessToken))
        .expect(201)
    ).body as PrivacyNoticeBody;
    expect(reviewed.legallyReviewedAt).not.toBeNull();

    await request(app.getHttpServer())
      .post(`/privacy-notices/${created.id}/legal-review`)
      .set(bearer(dpo.accessToken))
      .expect(422);
  });

  it('404s an unknown notice', async () => {
    const app = await boot();
    const dpo = await makeUser(
      app,
      'notice-dpo-404',
      'DATA_PROTECTION_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/privacy-notices/00000000-0000-0000-0000-000000000000')
      .set(bearer(dpo.accessToken))
      .expect(404);
  });

  /**
   * Part IV §10.4 — reading a notice and publishing one are two different acts
   * by two different sets of people, so they are two permissions.
   *
   * A Sales Officer stands in front of the data subject at intake and must be
   * able to show them the applicable notice; they must never be able to change
   * what it says. Before `privacy-notice.read` existed the read was authorised
   * by `consent.manage` — the right people, reached through a WRITE permission
   * on a different resource, which is the coupling this separates.
   */
  it('lets a touchpoint role READ the applicable notice but never publish one', async () => {
    const app = await boot();
    const dpo = await makeUser(app, 'pn-dpo-split', 'DATA_PROTECTION_OFFICER');
    const sales = await makeUser(
      app,
      'pn-sales-split',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const touchpoint = `lead_capture`;
    await request(app.getHttpServer())
      .post('/privacy-notices')
      .set(bearer(dpo.accessToken))
      .send({
        touchpoint,
        textEn: 'We process your data to quote and place insurance.',
        textAr: 'نعالج بياناتك لتسعير وإصدار التأمين.',
      })
      .expect(201);

    // READ — the whole point: this is the call the intake widget makes.
    await request(app.getHttpServer())
      .get(`/privacy-notices/current?touchpoint=${touchpoint}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    await request(app.getHttpServer())
      .get('/privacy-notices')
      .set(bearer(sales.accessToken))
      .expect(200);

    // PUBLISH — still refused. Splitting read out must not widen who writes.
    await request(app.getHttpServer())
      .post('/privacy-notices')
      .set(bearer(sales.accessToken))
      .send({ touchpoint, textEn: 'Not allowed.', textAr: 'غير مسموح.' })
      .expect(403);

    // And the permission set the UI renders from says the same thing, so the
    // screen hides the publish control instead of offering a guaranteed 403.
    const me = (
      await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(sales.accessToken))
        .expect(200)
    ).body as { permissions: string[] };
    expect(me.permissions).toContain('privacy-notice.read');
    expect(me.permissions).not.toContain('privacy-notice.publish');
  });
});
