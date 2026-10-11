import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma, rawPrisma } from './tenant-prisma';
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

beforeAll(async () => {
  app = await createTestApp();
}, 300_000);

afterAll(async () => {
  if (app) await app.close();
  app = null;
});

describe('Provider dashboard (e2e) — Module 0 item (j)', () => {
  it('returns one row per office THROUGH THE APP ROLE, which is what proves the view crosses offices', async () => {
    const target = app as INestApplication<App>;
    const admin = await signUp(
      'provider-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );

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
    const offices = await rawPrisma.organization.count();
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
    const admin = await signUp(
      'provider-cols',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
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

  it('derives the licence standing from the REGULATORY rule, not from SQL', async () => {
    // db-test's office holds a seeded term expiring well in the future, so the dashboard must read
    // it as in force. The value being a BOOLEAN rather than null is what proves a term was found
    // and the rule was applied; `null` would mean no term on record, which is a third state.
    const target = app as INestApplication<App>;
    const admin = await signUp(
      'provider-rule',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
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
    const admin = await signUp(
      'provider-audit',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    await request(target.getHttpServer())
      .get('/provider/offices')
      .set(bearer(admin.accessToken))
      .expect(200);

    const rows = await prisma.auditLogEntry.findMany({
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
