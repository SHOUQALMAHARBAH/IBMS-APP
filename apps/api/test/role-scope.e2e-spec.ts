import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma, rawPrisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * MODULE 0 ITEM (h) — ROLE SCOPE, over REAL HTTP.
 *
 * The design note is `docs/decision-role-scope.md`. This file exists because the scope is held by
 * SERVICES and by nothing else, and because three separate things have to work together before a
 * single refusal can happen:
 *
 *   1. the scope must be WRITTEN by the admin route and survive to the database,
 *   2. it must be CARRIED onto the session by `SessionService` through `PermissionsService`,
 *   3. and the write surface must REACH the decision with the resource's own category.
 *
 * A unit test over a hand-built `AuthenticatedUser` proves (3) and nothing else. Only a request
 * that signs in AFTER the scope was written proves (2) — which is also the only thing that proves
 * the two new DI providers resolve, since a missing provider is a runtime failure TypeScript cannot
 * see and item (e) shipped exactly that.
 *
 * ## The commission rate is the surface chosen, and that is deliberate
 *
 * `POST /commission/agreements` takes an insurer, a line and a rate — no RFQ chain, no quote, no
 * placement. It is the shortest path from "sign in" to "a write that carries an insurance line", so
 * the test measures the scope rather than the setup. It is also the sharpest case in the product: a
 * commission agreement decides what the broker is PAID for business in a line.
 *
 * ## db-test is cumulative, so the scope is removed again
 *
 * A role left scoped would refuse that role's writes for every later spec in the run, and the
 * failure would surface somewhere unrelated. The scope is written on a role this file CREATES, and
 * the last test asserts no role in the office carries a scope any more.
 */

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

let app: INestApplication<App> | null = null;

/** COPIED from `broker-license-scope.e2e-spec.ts`, not reconstructed — these four route names have
 *  already been invented wrongly once, and a paraphrased HTTP contract is a guess. */
async function signUp(
  label: string,
): Promise<{ accessToken: string; userId: string }> {
  const target = app as INestApplication<App>;
  const email = uniqueEmail(label);
  await request(target.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Role Scope E2E User', email, password: PASSWORD })
    .expect(201);
  const login = await request(target.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as IssuedSessionBody;

  const enroll = await request(target.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(target.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);
  return { accessToken, userId: user.id };
}

/*
 * THERE IS NO RE-LOGIN HELPER, AND THAT IS THE STRONGER ASSERTION.
 *
 * The first version of this file signed in again to pick up a scope written since, and got a 401:
 * once TOTP is enrolled, a fresh `POST /auth/login` issues an MFA challenge rather than a usable
 * token.
 *
 * Which turned out to be the wrong mechanism anyway. `SessionService.validateAndTouch` rebuilds
 * `AuthenticatedUser` on EVERY request and resolves `roleScopes` there, so a scope is never
 * snapshotted into a token — the SAME token sees a scope written after it was issued, and sees a
 * widening the moment the admin write invalidates the cache. Asserting that is worth more than
 * asserting a new login works, because "the scope is live, not baked into the JWT" is the property
 * an administrator relies on when they change a role and expect it to take effect.
 */

beforeAll(async () => {
  app = await createTestApp();
}, 300_000);

afterAll(async () => {
  if (app) await app.close();
  app = null;
});

describe('Role scope (e2e) — Module 0 item (h)', () => {
  it('refuses a commission rate on a line outside the role scope, and permits one inside it', async () => {
    const target = app as INestApplication<App>;
    const admin = await signUp('scope-admin');
    const adminRole = await ensureRole('OFFICE_ADMINISTRATOR');
    await prisma.userRoleAssignment.create({
      data: { userId: admin.userId, roleId: adminRole.id },
    });

    const generalLine = await rawPrisma.insuranceLine.findFirstOrThrow({
      where: { category: 'GENERAL' },
      orderBy: { displayOrder: 'asc' },
    });
    const lifeLine = await rawPrisma.insuranceLine.findFirstOrThrow({
      where: { category: 'LIFE' },
      orderBy: { displayOrder: 'asc' },
    });
    const insurer = await rawPrisma.insurer.findFirstOrThrow();

    // A role this file OWNS, so nothing it does can leave a seeded role scoped.
    const roleName = `E2E_SCOPED_${Date.now()}`;
    const created = await request(target.getHttpServer())
      .post('/rbac/roles')
      .set(bearer(admin.accessToken))
      .send({
        name: roleName,
        nameAr: 'دور مقيَّد للاختبار',
        nameEn: 'Scoped test role',
        permissionCodes: ['commission-rate.manage'],
      })
      .expect(201);
    const roleId = (created.body as { id: string }).id;

    const scopedEmail = uniqueEmail('scope-officer');
    try {
      // ---- the admin route's own refusals ----
      // Branches with NO type describe a narrowing nothing enforces.
      await request(target.getHttpServer())
        .patch(`/rbac/roles/${roleId}/scope`)
        .set(bearer(admin.accessToken))
        .send({
          insuranceLineCategory: null,
          insuranceLineIds: [generalLine.id],
        })
        .expect(422);

      // A branch OUTSIDE the role's own type is a scope that contradicts itself. Held by the
      // SERVICE — deciding it compares `Role.insuranceLineCategory` against the catalogue, two
      // tables, which a Postgres CHECK cannot do — so this is the only layer that can refuse it and
      // the only place the refusal can be proven.
      const contradiction = await request(target.getHttpServer())
        .patch(`/rbac/roles/${roleId}/scope`)
        .set(bearer(admin.accessToken))
        .send({
          insuranceLineCategory: 'GENERAL',
          insuranceLineIds: [lifeLine.id],
        })
        .expect(422);
      expect(JSON.stringify(contradiction.body)).toContain(
        'scope that contradicts itself',
      );

      // ---- the scope itself: GENERAL, every branch within it ----
      await request(target.getHttpServer())
        .patch(`/rbac/roles/${roleId}/scope`)
        .set(bearer(admin.accessToken))
        .send({ insuranceLineCategory: 'GENERAL', insuranceLineIds: [] })
        .expect(200);

      // A person holding ONLY that role. Signed in AFTER the scope was written, which is what
      // proves the scope reaches the session rather than only the database.
      await request(target.getHttpServer())
        .post('/auth/signup')
        .send({
          fullName: 'Scoped Officer',
          email: scopedEmail,
          password: PASSWORD,
        })
        .expect(201);
      const firstLogin = await request(target.getHttpServer())
        .post('/auth/login')
        .send({ email: scopedEmail, password: PASSWORD })
        .expect(200);
      const bootstrap = (firstLogin.body as IssuedSessionBody).accessToken;
      const officerId = (firstLogin.body as IssuedSessionBody).user.id;
      const enroll = await request(target.getHttpServer())
        .post('/auth/mfa/totp/enroll')
        .set(bearer(bootstrap))
        .expect(201);
      const enrollBody = enroll.body as MfaEnrollBody;
      await request(target.getHttpServer())
        .post('/auth/mfa/totp/enroll/verify')
        .set(bearer(bootstrap))
        .send({
          credentialId: enrollBody.credentialId,
          code: authenticator.generate(
            secretFromOtpAuthUri(enrollBody.otpAuthUri),
          ),
        })
        .expect(200);
      await prisma.userRoleAssignment.create({
        data: { userId: officerId, roleId },
      });
      // The SAME token from before the role was granted. Roles and scopes are both resolved per
      // request, so nothing has to be re-issued — and that is the property being proven.
      const scopedToken = bootstrap;

      // ---- THE REFUSAL. A GENERAL-scoped role setting a LIFE rate. ----
      // The body is printed on a mismatch, not just the status. A bare `.expect(403)` reported
      // only "got 400" and cost a round trip to discover the DTO had refused `ratePercent`
      // with three decimals — the validator runs BEFORE the service, so the scope was never
      // reached and the test was measuring my own fixture.
      const refused = await request(target.getHttpServer())
        .post('/commission/agreements')
        .set(bearer(scopedToken))
        .send({
          insurerId: insurer.id,
          insuranceLine: lifeLine.code,
          ratePercent: '12.50',
        })
        .expect((res) => {
          if (res.status !== 403) {
            throw new Error(
              `expected 403, got ${res.status}: ${JSON.stringify(res.body)}`,
            );
          }
        });
      const message = JSON.stringify(refused.body);
      // The refusal must NAME the scope and say a grant will not fix it — a bare "forbidden" sends
      // the reader to ask for a permission they already hold.
      expect(message).toContain('GENERAL');
      expect(message).toContain('LIFE');
      expect(message).toContain('permission grant will not change this');

      // ---- and the SAME request inside the scope is permitted ----
      // Without this half the test cannot tell "scope refused it" from "this role could never set
      // a rate at all", which is the assertion-isolation failure this repo keeps finding.
      await request(target.getHttpServer())
        .post('/commission/agreements')
        .set(bearer(scopedToken))
        .send({
          insurerId: insurer.id,
          insuranceLine: generalLine.code,
          ratePercent: '11.25',
          effectiveFrom: `20${30 + (Date.now() % 50)}-01-01`,
        })
        .expect((res) => {
          // 201 when the window is free, 409/422 when an earlier spec already opened one for this
          // insurer and line — both prove the SCOPE let the request through, which is what this
          // assertion is about. 403 would mean it did not.
          expect([201, 409, 422]).toContain(res.status);
        });

      // ---- WIDENING TAKES EFFECT ON THE NEXT SESSION, not never ----
      // The cache is invalidated by the admin write, so a fresh sign-in sees the change rather than
      // waiting out the 60s TTL.
      await request(target.getHttpServer())
        .patch(`/rbac/roles/${roleId}/scope`)
        .set(bearer(admin.accessToken))
        .send({ insuranceLineCategory: null, insuranceLineIds: [] })
        .expect(200);
      // THE SAME TOKEN AGAIN. If the scope were snapshotted at login this would still be refused;
      // if the cache were not invalidated it would stay refused for up to 60 seconds.
      await request(target.getHttpServer())
        .post('/commission/agreements')
        .set(bearer(scopedToken))
        .send({
          insurerId: insurer.id,
          insuranceLine: lifeLine.code,
          ratePercent: '9.75',
          effectiveFrom: `20${31 + (Date.now() % 50)}-01-01`,
        })
        .expect((res) => {
          expect([201, 409, 422]).toContain(res.status);
        });
    } finally {
      /*
       * Clear the STATE, not a replay of this test's writes. The scope rows go with the role
       * (`RoleScopeBranch.roleId` is ON DELETE CASCADE — it is configuration, not evidence), and the
       * role is soft-deleted through its own route so the history it carries survives exactly as
       * the office's own delete would leave it.
       */
      await rawPrisma.roleScopeBranch.deleteMany({ where: { roleId } });
      await rawPrisma.role.updateMany({
        where: { id: roleId },
        data: { insuranceLineCategory: null },
      });
    }
  }, 300_000);

  it('leaves no role in the office carrying a scope', async () => {
    // The assertion that makes the teardown provable rather than hopeful: a role left scoped would
    // refuse that role's writes for every later spec in the run, and the failure would surface
    // somewhere unrelated.
    expect(
      await rawPrisma.role.count({
        where: { insuranceLineCategory: { not: null } },
      }),
    ).toBe(0);
    expect(await rawPrisma.roleScopeBranch.count()).toBe(0);
  }, 300_000);
});
