import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import {
  ensureRole,
  prisma,
  rawPrisma,
  TEST_ORGANIZATION_ID,
} from './tenant-prisma';
import { createTestApp } from './utils/test-app';
import { PROVIDER_OFFICE_STATE_COLUMNS } from '../src/repositories/provider-office-state.repository';

/**
 * MODULE 0 ITEM (j) — THE PROVIDER DASHBOARD, over REAL HTTP.
 *
 * Three properties, and none of them can be proven anywhere else:
 *
 *   1. THE VIEW CROSSES OFFICES. `security_invoker = false` is what makes that work, and the way it
 *      fails is silent: with `security_invoker = true` the view runs as the app role, RLS filters it
 *      to the caller's own office, and a "cross-office dashboard" shows exactly one row while
 *      looking like it works. Only a request through the app role can tell the two apart — the
 *      migration's own assertion runs as the OWNER, who is exempt either way.
 *   2. THE COLUMN LIST IS THE BOUNDARY. The response body is checked for the absence of anything
 *      personal, customer, policy or money-shaped, one key at a time.
 *   3. THE PERMISSION GATES IT. One code, and a reader without it gets 403.
 *
 * db-test holds ONE organization, so the cross-office property is proven by the row count matching
 * `Organization` rather than by seeing two offices — and that is the honest form: asserting "more
 * than one row" would be a test that only passes on a database that happens to have two.
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
interface OfficeRow {
  organizationId: string;
  legalName: string;
  licenseNumber: string | null;
  isCurrentlyLapsed: boolean | null;
  renewalDueBy: string | null;
  licensedBranches: number;
  dormantLicensedBranches: number;
  users: number;
  activeUsers: number;
  lastActivityAt: string | null;
}

let app: INestApplication<App> | null = null;

/** COPIED from `role-scope.e2e-spec.ts`, not reconstructed. */
async function signUp(
  label: string,
  ...roles: Parameters<typeof ensureRole>[0][]
): Promise<{ accessToken: string; userId: string }> {
  const target = app as INestApplication<App>;
  const email = uniqueEmail(label);
  await request(target.getHttpServer())
    .post('/auth/signup')
    .send({
      fullName: 'Provider Dashboard E2E User',
      email,
      password: PASSWORD,
    })
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

  for (const roleName of roles) {
    const role = await ensureRole(roleName);
    const active = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId: role.id, revokedAt: null },
    });
    if (!active) {
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
  }
  return { accessToken, userId: user.id };
}

/**
 * A user of the PROVIDER organization, holding its seeded `PLATFORM_OPERATOR` role.
 *
 * `signUp` cannot be reused: `POST /auth/signup` creates the user in the office the request
 * resolves to, and there is exactly one provider organization created by the seed. So the account is
 * created with the OWNER client, directly in that organization, and then signs in normally — which
 * is what proves the route serves a real session rather than a fabricated `AuthenticatedUser`.
 */
async function providerUser(
  label: string,
): Promise<{ accessToken: string; userId: string }> {
  const target = app as INestApplication<App>;
  const email = uniqueEmail(label);

  /*
   * Found BY TYPE, not by an id. `PROVIDER_ORGANIZATION_ID` lives in `packages/db/prisma/seed.ts`,
   * which is OUTSIDE `@ibms/db`'s exported `src` — importing it typechecks on a laptop and fails
   * inside the pruned Docker image, which this repository has paid for once.
   *
   * It is also the better assertion: `findFirstOrThrow` here fails loudly if the seed did not create
   * a provider, rather than failing later as a confusing 403.
   */
  const org = await rawPrisma.organization.findFirstOrThrow({
    where: { type: 'PROVIDER' },
  });
  const role = await rawPrisma.role.findFirstOrThrow({
    where: { organizationId: org.id, name: 'PLATFORM_OPERATOR' },
  });

  // `bcryptjs` at cost 12, which is what `seed.ts` uses — copied from there rather than guessed,
  // because a hash the login path cannot verify would fail as "wrong password" and look like a
  // credential problem rather than a fixture one.
  const bcrypt = await import('bcryptjs');
  const created = await rawPrisma.user.create({
    data: {
      organizationId: org.id,
      email,
      fullName: 'Platform Operator E2E',
      passwordHash: await bcrypt.hash(PASSWORD, 12),
      isActive: true,
      /*
       * FALSE, explicitly. `User.mustChangePassword` DEFAULTS TO TRUE, so a directly-created user's
       * login returns `{"outcome":"MUST_CHANGE_PASSWORD", onboardingToken}` with no `accessToken` —
       * and the next request then failed with `jwt malformed`, an error about the token's SHAPE for
       * a problem that was about the account's state.
       *
       * The default is right for a real account (an administrator sets a temporary password) and
       * wrong for a fixture that signs in once. `POST /auth/signup` sets it false for the same
       * reason, which is why the sibling helper never needed to say so.
       */
      mustChangePassword: false,
    },
  });
  const login = await request(target.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken } = login.body as IssuedSessionBody;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error(
      `provider login returned no accessToken: ${JSON.stringify(login.body)}`,
    );
  }

  const enroll = await request(target.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect((res) => {
      if (res.status !== 201) {
        throw new Error(
          `provider MFA enrol expected 201, got ${res.status}: ${JSON.stringify(res.body)}`,
        );
      }
    });
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(target.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  /*
   * THE ROLE IS GRANTED LAST, and the order is load-bearing.
   *
   * `PLATFORM_OPERATOR` carries `requiresMfaAlways` — the schema default is the STRICT value — so a
   * user who already holds it gets an MFA CHALLENGE from `POST /auth/login` rather than a token.
   * The first version granted the role first and the enrol then failed with `jwt malformed`, because
   * `accessToken` was undefined on a challenge response: an error about the token's shape for a
   * problem that was about ordering.
   *
   * `signUp` above works for the same reason without saying so — `POST /auth/signup` creates a user
   * with NO roles, and its caller grants them after enrolment.
   *
   * `organizationId` is NAMED EXPLICITLY: it is `@default(dbgenerated())` reading
   * `app.current_org_id`, and the OWNER client sets no tenant context, so the default resolves to
   * NULL and the insert fails on a not-null violation.
   */
  await rawPrisma.userRoleAssignment.create({
    data: {
      organizationId: org.id,
      userId: created.id,
      roleId: role.id,
    },
  });

  return { accessToken, userId: created.id };
}

beforeAll(async () => {
  app = await createTestApp();
}, 300_000);

afterAll(async () => {
  if (app) await app.close();
  app = null;
});

describe('Provider dashboard (e2e) — Module 0 item (j)', () => {
  it('returns one row per BROKERAGE OFFICE through the app role, which is what proves the view crosses offices', async () => {
    const target = app as INestApplication<App>;
    const admin = await providerUser('provider-admin');

    const body = (
      await request(target.getHttpServer())
        .get('/provider/offices')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body as OfficeRow[];

    /*
     * THE ASSERTION THAT CANNOT BE MADE ANYWHERE ELSE.
     *
     * This request goes through the APP ROLE (`ibms_app`), which RLS applies to. If the view were
     * `security_invoker = true` it would be filtered to the caller's own office and this count would
     * be 1 whatever the platform held — and on db-test, which has one organization, that would LOOK
     * CORRECT. So the count is compared against `Organization` read with the OWNER client, which is
     * the only pair of numbers that can disagree.
     */
    // BROKERAGE OFFICES, not all organizations: item (j)'s gap closure filtered the view, because a
    // PROVIDER or INSURANCE_COMPANY row would be reported as an office with no licence term — a
    // false finding about a regulatory failure.
    const offices = await rawPrisma.organization.count({
      where: { type: 'BROKERAGE_OFFICE' },
    });
    expect(offices).toBeGreaterThan(0);
    expect(
      body.length,
      'the dashboard returned a different number of offices than exist. If it returned exactly 1, check `security_invoker` on the view: as `true` it is filtered by RLS to the caller’s own office and looks correct on a single-office database.',
    ).toBe(offices);

    // And it resolves its dependencies — a missing provider is a runtime DI failure `tsc` cannot
    // see, which item (e) shipped once.
    expect(body[0].organizationId).toBeTruthy();
    expect(body[0].legalName).toBeTruthy();
  }, 300_000);

  it('exposes OFFICE STATE and nothing personal, customer, policy or money-shaped', async () => {
    /*
     * The column list IS the privacy and commercial boundary, so it is asserted on the RESPONSE
     * BODY rather than trusted to the migration. The migration checks the VIEW; this checks what a
     * caller actually receives, and the two can diverge — the repository selects an explicit list,
     * and a future `SELECT *` there would pass the migration's check and fail this one.
     */
    const target = app as INestApplication<App>;
    const admin = await providerUser('provider-cols');
    const body = (
      await request(target.getHttpServer())
        .get('/provider/offices')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body as Record<string, unknown>[];

    const row = body[0];
    if (!row) throw new Error('the dashboard returned no offices at all');

    // ONE KEY AT A TIME. A single `toEqual` over the whole shape would pass the moment somebody
    // regenerated the expectation from the actual response, which is how a widened payload gets
    // blessed.
    for (const banned of [
      'userId',
      'lastSignInUserId',
      'email',
      'phone',
      'nationalId',
      'customerCount',
      'policyCount',
      'premium',
      'premiumWritten',
      'commission',
      'paidUpCapital',
      'fullName',
    ]) {
      expect(
        Object.prototype.hasOwnProperty.call(row, banned),
        `the provider dashboard returned \`${banned}\`. This is a CROSS-OFFICE read: no personal data, no customer or policy data, no money. See migration 20261116100000 before widening it.`,
      ).toBe(false);
    }

    // The office-level facts ARE there — the other half, so this cannot pass by returning nothing.
    for (const expected of [
      'licensedBranches',
      'dormantLicensedBranches',
      'users',
      'activeUsers',
      'lastActivityAt',
      'isCurrentlyLapsed',
    ]) {
      expect(
        Object.prototype.hasOwnProperty.call(row, expected),
        `the provider dashboard is missing \`${expected}\` — the screen reads it, and the web interface is hand-copied over HTTP so TypeScript cannot see this.`,
      ).toBe(true);
    }

    // `lastActivityAt` is an OFFICE-level maximum. The property that makes it not personal data is
    // that no user is named anywhere in the row — asserted above by the absence of `userId`.
    expect(typeof row.users).toBe('number');
    expect(typeof row.activeUsers).toBe('number');
  }, 300_000);

  it('CARRIES ONE REGULATORY FACT AND NOTHING BEHIND IT — an EXACT key set', async () => {
    /*
     * MODULE 0-ب, ITEM B. Register entry 97, closed: the provider sees *this office may not issue*
     * and nothing else.
     *
     * THE EXACT SET IS THE POINT, and it is a different guard from the banned-name loop above —
     * both are kept deliberately:
     *
     *   * the LOOP catches a field somebody adds that we already thought to ban, and names it;
     *   * the SET catches one NOBODY NAMED. That is the realistic shape of a regulatory-detail
     *     leak: whoever adds `regulatorDecisionNumber` or `sanctionBasis` will not have read a ban
     *     list first, and a `toHaveProperty` list keeps passing while their field appears beside it.
     *
     * A sanction's contents are the OFFICE'S. The provider neither corrects them nor is bound by
     * any deadline they carry (decision 92), so it has no use for them and no business holding
     * them.
     */
    const target = app as INestApplication<App>;
    const admin = await providerUser('provider-bar');
    const body = (
      await request(target.getHttpServer())
        .get('/provider/offices')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body as Record<string, unknown>[];
    const row = body[0];
    if (!row) throw new Error('the dashboard returned no offices at all');

    expect(Object.keys(row).sort()).toEqual([
      'activeUsers',
      'brokerKind',
      'dormantLicensedBranches',
      'isCurrentlyLapsed',
      'lastActivityAt',
      'legalName',
      'legalNameAr',
      'licenseExpiresAt',
      'licenseIssuedAt',
      'licenseNumber',
      'licensedBranches',
      'mayNotIssue',
      'onboardedAt',
      'organizationId',
      'organizationStatus',
      'organizationType',
      'renewalDueBy',
      'renewalFiledOnTime',
      'renewalRequestedAt',
      'subdomain',
      'users',
    ]);

    // THE FACT IS A BOOLEAN, never null — "no regulator has barred this office" is a definite
    // answer, and a null would make a reader guess whether it meant unknown.
    expect(typeof row.mayNotIssue).toBe('boolean');
  }, 300_000);

  it('the one fact TURNS TRUE on a recorded bar, and the detail still does not travel', async () => {
    /*
     * The positive half. Without it the assertion above passes on a payload where `mayNotIssue` is
     * hard-wired `false` — the shape would be right and the fact would be useless.
     *
     * A REAL `RegulatoryAction` row, written directly rather than through the route, because the
     * route is tenant-scoped to the caller's own office and this read is about ANOTHER office. That
     * is register entry 97 in one sentence, and it is why the fact had to be computed inside the
     * security-definer view at all.
     */
    const target = app as INestApplication<App>;
    const admin = await providerUser('provider-bar-live');
    const office = await rawPrisma.organization.findFirstOrThrow({
      where: { type: 'BROKERAGE_OFFICE' },
      select: { id: true, subdomain: true },
    });
    const recorder = await rawPrisma.user.findFirstOrThrow({
      where: { organizationId: office.id },
      select: { id: true },
    });

    const suspension = await rawPrisma.regulatoryAction.create({
      data: {
        organizationId: office.id,
        kind: 'SUSPENSION',
        basis: 'SANCTION',
        /*
         * TODAY, not a historical date — and the first version used 2020, which FAILED.
         *
         * db-test accumulates acts from the licence specs, all dated the day they run, so a 2020
         * suspension is not the STANDING act: the view folds by `effectiveFrom` then `recordedAt`
         * then `id`, and a reinstatement dated today outranks it. The fixture was asserting about
         * an act the fold had already superseded.
         *
         * Same carelessness as the 2020-term fixture one batch ago, and the fold being a total
         * order is exactly why this is now deterministic rather than intermittent: dated today and
         * recorded last, this act IS the standing one, every run.
         */
        effectiveFrom: new Date(),
        decisionRef: 'CBJ/PROVIDER-VIEW-E2E',
        recordedByUserId: recorder.id,
      },
      select: { id: true },
    });
    try {
      const body = (
        await request(target.getHttpServer())
          .get('/provider/offices')
          .set(bearer(admin.accessToken))
          .expect(200)
      ).body as Record<string, unknown>[];
      const barred = body.find((r) => r.subdomain === office.subdomain);
      expect(
        barred,
        'the barred office is missing from the dashboard',
      ).toBeDefined();
      expect(barred?.mayNotIssue).toBe(true);

      // AND STILL NOTHING BEHIND IT, asserted on the SAME row that is now barred — which is the
      // only row where a leak could carry anything, and therefore the only place this assertion
      // means something.
      expect(JSON.stringify(barred)).not.toContain('CBJ/PROVIDER-VIEW-E2E');
      expect(JSON.stringify(barred)).not.toContain('SUSPENSION');
      expect(JSON.stringify(barred)).not.toContain('SANCTION');

      // THE CONSEQUENCE THE OWNER ACCEPTED, asserted so nobody "fixes" it by withdrawing the dates:
      // the licence number and expiry are still here, so a bar on a currently-valid licence IS
      // distinguishable from an expiry. That is the intent.
      expect(barred?.licenseNumber).not.toBeNull();
    } finally {
      // Removed either way. A standing suspension left on db-test's only office would refuse every
      // later policy placement in the run — and would also make this very assertion pass for the
      // wrong reason on the next run.
      await rawPrisma.regulatoryAction.delete({ where: { id: suspension.id } });
    }
  }, 300_000);

  it('derives the licence standing from the REGULATORY rule, not from SQL', async () => {
    // db-test's office holds a seeded term expiring well in the future, so the dashboard must read
    // it as in force. The value being a BOOLEAN rather than null is what proves a term was found
    // and the rule was applied; `null` would mean no term on record, which is a third state.
    const target = app as INestApplication<App>;
    const admin = await providerUser('provider-rule');
    const body = (
      await request(target.getHttpServer())
        .get('/provider/offices')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body as OfficeRow[];

    const withTerm = body.filter((o) => o.licenseNumber !== null);
    expect(
      withTerm.length,
      'no office in db-test holds a licence term, so the standing rule cannot be exercised — the seed should have created one (item (c)).',
    ).toBeGreaterThan(0);

    for (const office of withTerm) {
      expect(typeof office.isCurrentlyLapsed).toBe('boolean');
      // Art. 11's 45-day deadline is derived too, and is present whenever a term is.
      expect(office.renewalDueBy).toBeTruthy();
    }
  }, 300_000);

  it('is gated on one permission code, and the refusal is a 403', async () => {
    const target = app as INestApplication<App>;
    const other = await signUp('provider-other', 'SALES_RELATIONSHIP_OFFICER');
    await request(target.getHttpServer())
      .get('/provider/offices')
      .set(bearer(other.accessToken))
      .expect(403);
  }, 300_000);

  it('writes an audit row naming the act and COUNTS only, never what was read', async () => {
    /*
     * Who looked at the platform-wide picture is worth recording. WHAT they saw is not: copying
     * other offices' state into this office's own append-only audit table would duplicate exactly
     * the data the column list exists to bound.
     */
    const target = app as INestApplication<App>;
    const admin = await providerUser('provider-audit');
    await request(target.getHttpServer())
      .get('/provider/offices')
      .set(bearer(admin.accessToken))
      .expect(200);

    // `rawPrisma`, not `prisma`. The audit row is written in the PROVIDER organization — that is
    // where the actor belongs — and the tenant-scoped test client is pinned to the brokerage
    // office, so it reads zero rows and the assertion fails with no hint that the row exists one
    // tenant away. The owner client is the right reader for a cross-tenant assertion in a test.
    const rows = await rawPrisma.auditLogEntry.findMany({
      where: { entityType: 'ProviderOfficeState', userId: admin.userId },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const recorded = JSON.stringify(rows[0].afterValue);
    expect(recorded).toContain('officesReturned');
    // No office NAME in the row — the count is the record, not the contents.
    expect(recorded).not.toContain('legalName');
    expect(recorded).not.toContain('licenseNumber');
  }, 300_000);

  it('the declared column list and the view agree — and the list is not empty', async () => {
    // The repository asserts this on every call and throws if the two disagree; this is the
    // non-vacuity half, so a declared list that somehow became empty cannot pass by checking
    // nothing.
    expect(PROVIDER_OFFICE_STATE_COLUMNS.length).toBeGreaterThan(10);
    const cols = await rawPrisma.$queryRawUnsafe<{ attname: string }[]>(
      `SELECT a."attname" FROM pg_attribute a
        WHERE a."attrelid" = '"ProviderOfficeState"'::regclass
          AND a."attnum" > 0 AND NOT a."attisdropped"`,
    );
    expect(new Set(cols.map((c) => c.attname))).toEqual(
      new Set(PROVIDER_OFFICE_STATE_COLUMNS),
    );
  }, 300_000);
});

/*
 * MODULE 0 ITEM (j)'s GAP CLOSURE — the four tests the owner named.
 */

describe('Provider dashboard — the provider-only boundary', () => {
  it('A BROKERAGE USER HOLDING THE CODE IS REFUSED, AND THE REFUSAL SAYS WHY', async () => {
    /*
     * THE TEST THIS WHOLE CLOSURE IS FOR.
     *
     * The permission alone is no longer the gate. `setPermissions` refuses granting a PLATFORM code
     * to a brokerage office and the matrix never offers it — but a grant that predates the rule, or
     * a row written directly, still carries the code. This drives exactly that state: the grant is
     * written with the OWNER client, bypassing every application check, which is the only way to
     * reach it.
     *
     * AND IT MUST NOT BE AN EMPTY LIST. `[]` would read as "no offices exist" — the silent failure
     * this project keeps removing. So the status is asserted AND the sentence is read.
     */
    const target = app as INestApplication<App>;
    const office = await signUp(
      'legacy-holder',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );

    const permission = await rawPrisma.permission.findUniqueOrThrow({
      where: { code: 'provider.office-state.read' },
    });
    const role = await ensureRole('SYSTEM_SECURITY_ADMINISTRATOR');
    const planted = await rawPrisma.rolePermission.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        roleId: role.id,
        permissionId: permission.id,
      },
    });

    try {
      const refused = await request(target.getHttpServer())
        .get('/provider/offices')
        .set(bearer(office.accessToken))
        .expect(403);

      const message = JSON.stringify(refused.body);
      // It names the reason...
      expect(message).toContain('platform operator');
      // ...says the caller's own type, so the reader knows which fact decided it...
      expect(message).toContain('BROKERAGE_OFFICE');
      // ...says plainly that this is NOT an empty result...
      expect(message).toContain('NOT because the list is');
      // ...and that a grant is not the remedy, because the obvious next move is to ask for one.
      expect(message).toContain('permission grant will not change it');
    } finally {
      // The planted grant is removed whatever happened: left behind, it would make every later spec
      // in this run see a brokerage office holding a platform code.
      await rawPrisma.rolePermission.delete({ where: { id: planted.id } });
    }
  }, 300_000);

  it('A PROVIDER USER SEES EVERY OFFICE', async () => {
    const target = app as INestApplication<App>;
    const operator = await providerUser('provider-sees-all');
    const body = (
      await request(target.getHttpServer())
        .get('/provider/offices')
        .set(bearer(operator.accessToken))
        .expect(200)
    ).body as OfficeRow[];

    const offices = await rawPrisma.organization.count({
      where: { type: 'BROKERAGE_OFFICE' },
    });
    expect(body.length).toBe(offices);
    // And the provider's OWN organization is not in the list: it is not a brokerage office, and a
    // row for it would read as an unlicensed one.
    const provider = await rawPrisma.organization.findFirstOrThrow({
      where: { type: 'PROVIDER' },
    });
    expect(
      body.some((o) => o.organizationId === provider.id),
      'the provider organization appears in its own office list, where it would be reported as an office with no licence term',
    ).toBe(false);
  }, 300_000);

  it('A SECOND PROVIDER ORGANIZATION IS REFUSED BY THE DATABASE', async () => {
    /*
     * The OWNER client, deliberately: this asserts the partial unique
     * `Organization_one_provider`, not an application check. Written through the harshest caller
     * there is, so no service could be mistaken for the thing refusing it.
     *
     * A sentinel throw AFTER the insert, so the transaction rolls back whether the INSERT succeeded
     * or failed — item (a)'s lesson, where a test that only rolled back by failing leaked a row
     * into db-test the moment the thing it guarded stopped working.
     */
    const SENTINEL = 'second-provider-probe-rolled-back';
    let refusal: unknown = null;
    try {
      await rawPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          // `legalNameAr` REQUIRED since module 0-ب Part E. Without it this INSERT is refused
          // for the wrong reason — 23502 rather than the partial unique — and the test would
          // have gone on passing while proving nothing about `Organization_one_provider`.
          `INSERT INTO "Organization" ("id","legalName","legalNameAr","type","subdomain","updatedAt")
             VALUES ('00000000-0000-0000-0000-00000000e001','E2E Second Provider','مزوّد ثانٍ للاختبار','PROVIDER','e2e-second-provider', now())`,
        );
        throw new Error(SENTINEL);
      });
    } catch (err) {
      refusal = err;
    }

    const message =
      refusal instanceof Error ? refusal.message : String(refusal);
    expect(
      message,
      'the second PROVIDER organization was ACCEPTED — the partial unique `Organization_one_provider` refuses nothing. Check it still carries its WHERE clause.',
    ).not.toBe(SENTINEL);
    // Postgres reports a unique violation as 23505 via Prisma's raw-query wrapper; the index NAME is
    // what pins which constraint refused it, since `Organization` carries others.
    expect(message).toMatch(/Organization_one_provider|23505|unique/i);

    // Nothing leaked, whichever way it went.
    expect(
      await rawPrisma.organization.count({
        where: { id: '00000000-0000-0000-0000-00000000e001' },
      }),
    ).toBe(0);
  }, 300_000);

  it('NOTHING ELSE BECAME CROSS-OFFICE — the view is still the only tenant-spanning surface beside the insurer directory', async () => {
    /*
     * The owner's fourth test, and the one that would catch a future widening nobody argued for.
     *
     * A `security_invoker = false` view is the ONLY mechanism in this codebase that can read across
     * offices: everything else goes through `tenantScopeExtension` (derived from the DMMF as "every
     * model carrying organizationId") with RLS behind it. So the set of such views IS the set of
     * cross-office surfaces, and it must be exactly two.
     *
     * `security-definer-views.e2e-spec.ts` requires each one to be DECLARED. This is the stronger
     * claim: that there are no others at all, so a third cannot arrive merely by being declared.
     */
    const views = await rawPrisma.$queryRawUnsafe<{ relname: string }[]>(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v'
          AND (c.reloptions IS NULL OR NOT ('security_invoker=true' = ANY(c.reloptions)))
        ORDER BY c.relname`,
    );
    expect(
      views.map((v) => v.relname),
      'the set of SECURITY DEFINER views changed. Each one reads PAST row-level security, so a new member is a new cross-office channel: declare it in `security-definer-views.e2e-spec.ts`, argue for its column list, and then change this assertion deliberately.',
    ).toEqual(['InsurerDirectory', 'ProviderOfficeState']);

    /*
     * And the application-layer complement: the only sanctioned ways to run a query WITHOUT tenant
     * filtering are the reasons named below. A member appearing here that is not in that list is a
     * cross-office path no view enumeration could see.
     *
     * ## PINNED AS A SET, AND IT USED TO BE PINNED AS ONE VALUE
     *
     * This read `.toEqual(['auth-bootstrap'])` under a message saying "a SECOND is a cross-office
     * channel". It fired on module 0-ب's `UnscopedReason` split and was right to — but its premise
     * did not hold: that change RENAMED one of two existing uses rather than adding a path.
     * Subdomain resolution had been wearing authentication's label, so the union reported one
     * reason while serving two. The call-site count was ten before and ten after.
     *
     * So the set is named rather than counted. A THIRD member still fails, which is the property
     * worth keeping; what no longer fails is correcting a label to match what it does.
     *
     * The third instance in this module of the same class — a quantity asserted where a set was
     * meant. See `docs/deferred-register.md` § standing rules.
     */
    const orgContext = readFileSync(
      join(
        __dirname,
        '..',
        'src',
        'common',
        'org-context',
        'org-context.service.ts',
      ),
      'utf8',
    );
    const reasons = [
      ...orgContext.matchAll(/^\s*\|?\s*'([a-z-]+)'(?:;|$)/gm),
    ].map((m) => m[1]);
    expect(
      [...reasons].sort(),
      '`UnscopedReason` names a reason this guard does not know. Each one is a path that runs tenant-scoped queries with filtering OFF, so an unrecognised member is a cross-office channel the view enumeration above cannot see. Adding one is a deliberate decision: argue for it, then name it here.',
    ).toEqual(['auth-bootstrap', 'subdomain-resolution']);
  }, 300_000);

  it('THE ROLE-SAVE PATH REFUSES A PLATFORM CODE FOR A BROKERAGE OFFICE — the flag hides it, the server refuses it', async () => {
    /*
     * ADDED BECAUSE A PLANT KILLED NOTHING. Setting the refusal's condition to `false` left all 94
     * rbac unit tests and all 10 tests in this file green — so the layer the owner required
     * explicitly ("a hidden control that the API still honours is not a boundary") was the one layer
     * with no test observing it.
     *
     * The matrix hiding the code is not this. `PUT /rbac/roles/:id/permissions` takes a LIST OF
     * CODES from the client, so hiding one on screen stops nobody who can write a request — which
     * is exactly what this test does.
     */
    const target = app as INestApplication<App>;
    const admin = await signUp('platform-grant', 'OFFICE_ADMINISTRATOR');

    const roleName = `E2E_PLATFORM_GRANT_${Date.now()}`;
    const created = await request(target.getHttpServer())
      .post('/rbac/roles')
      .set(bearer(admin.accessToken))
      .send({
        name: roleName,
        nameAr: 'دور اختبار النطاق',
        nameEn: 'Scope test role',
        permissionCodes: ['claim.read'],
      })
      .expect(201);
    const roleId = (created.body as { id: string }).id;

    try {
      const refused = await request(target.getHttpServer())
        .put(`/rbac/roles/${roleId}/permissions`)
        .set(bearer(admin.accessToken))
        .send({ permissionCodes: ['claim.read', 'provider.office-state.read'] })
        .expect(422);

      const message = JSON.stringify(refused.body);
      // It NAMES the code, so the administrator knows which box caused it...
      expect(message).toContain('provider.office-state.read');
      // ...says the reason in the product's own terms...
      expect(message).toContain('PLATFORM-scoped');
      expect(message).toContain('platform operator');
      // ...and says a grant is not the remedy, because asking for one is the obvious next move.
      expect(message).toContain('no permission grant will change that');

      // AND NOTHING WAS WRITTEN. A refusal that half-applied would be worse than none: the role
      // would silently lose `claim.read` while the administrator read an error about another code.
      const after = await request(target.getHttpServer())
        .get(`/rbac/roles/${roleId}`)
        .set(bearer(admin.accessToken))
        .expect(200);
      expect(
        (after.body as { permissionCodes: string[] }).permissionCodes,
      ).toEqual(['claim.read']);

      // The same request WITHOUT the platform code is accepted — so the refusal is about that code
      // and not about the route, which a one-sided test could not tell apart.
      await request(target.getHttpServer())
        .put(`/rbac/roles/${roleId}/permissions`)
        .set(bearer(admin.accessToken))
        .send({ permissionCodes: ['claim.read', 'claim.register'] })
        .expect(200);
    } finally {
      await request(target.getHttpServer())
        .delete(`/rbac/roles/${roleId}`)
        .set(bearer(admin.accessToken));
    }
  }, 300_000);
});
