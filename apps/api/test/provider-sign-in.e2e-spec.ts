import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { createTestApp } from './utils/test-app';
import { rawPrisma } from './tenant-prisma';

/**
 * MODULE 0-ب ITEM (a) — THE PROVIDER CAN SIGN IN, PROVEN OVER REAL HTTP.
 *
 * Item (j) shipped a dashboard nobody could open: the provider organization and its role existed,
 * no user did, and nobody inside it holds `user.manage` so none could be provisioned from within
 * the application either. The seed now creates the operator with NO USABLE PASSWORD, and this
 * walks the whole way in through the EXISTING flow:
 *
 *   forgot-password -> reset-password -> login -> TOTP challenge -> the dashboard
 *
 * ## WHY THIS IS AN e2e AND NOT A UNIT TEST
 *
 * Every claim here is about something only a running app can answer. That the reset flow resolves
 * an account in a NON-OFFICE organization is a property of `runUnscoped("auth-bootstrap")` plus the
 * tenant extension, not of a function. That MFA is forced is a property of a schema default
 * reaching a guard. And that the seeded password is unusable cannot be shown by reading the seed —
 * only by trying to sign in with something and being refused.
 */

const PROVIDER_EMAIL =
  process.env.PROVIDER_ADMIN_EMAIL ?? 'operator@ibms.local';
/** Satisfies the Part 10.1 policy. Chosen HERE, by the test, which is the whole point: nothing in
 *  the seed or the environment knows a password for this account. */
const CHOSEN_PASSWORD = 'Provider-Sets-This-Itself-2026';

let app: INestApplication<App>;
/** Restored in afterAll: db-test is cumulative and shared, so an account left with a password this
 *  file chose would make every later run of this spec start from a different state. */
let originalPasswordHash: string | null = null;
let providerUserId: string | null = null;

/**
 * Put the account back to the state the SEED leaves it in: no usable password, no MFA credential.
 *
 * Run at BOTH ends, and that is the whole reason this spec is re-runnable. db-test is cumulative
 * and shared: the first version of this file enrolled the operator in TOTP and stopped there, so on
 * the second run `/auth/login` answered with an MFA CHALLENGE instead of a token and the test that
 * asserts "a token is issued after a reset" failed — a test that passed once and then never again.
 *
 * `beforeAll` as well as `afterAll`, because a run killed midway leaves the credential behind and
 * the next run must not inherit it.
 */
async function restoreSeedAuthState(): Promise<void> {
  if (!providerUserId) return;
  await rawPrisma.mfaCredential.deleteMany({
    where: { userId: providerUserId },
  });
  await rawPrisma.user.update({
    where: { id: providerUserId },
    data: {
      mfaEnabled: false,
      mfaMethod: null,
      mfaEnrolledAt: null,
      mfaEnrollmentPending: false,
      ...(originalPasswordHash ? { passwordHash: originalPasswordHash } : {}),
    },
  });
}

beforeAll(async () => {
  app = await createTestApp();
  const user = await rawPrisma.user.findFirst({
    where: { email: PROVIDER_EMAIL, organization: { type: 'PROVIDER' } },
    select: { id: true, passwordHash: true },
  });
  providerUserId = user?.id ?? null;
  originalPasswordHash = user?.passwordHash ?? null;
  await restoreSeedAuthState();
}, 300_000);

afterAll(async () => {
  await restoreSeedAuthState();
  await app?.close();
}, 300_000);

describe('the provider operator account', () => {
  it('EXISTS, holds the platform role, and MFA is FORCED rather than offered', async () => {
    /*
     * `rawPrisma` deliberately: `User`, `Role` and `UserRoleAssignment` all carry `organizationId`
     * and are tenant-scoped, so the exported scoped client would answer for the default office and
     * report this account as absent. Measured on the last module: 30 roles scoped vs 31 raw.
     */
    expect(
      providerUserId,
      'the seed did not create a provider operator',
    ).not.toBeNull();

    const assignments = await rawPrisma.userRoleAssignment.findMany({
      where: { userId: providerUserId!, revokedAt: null },
      select: { role: { select: { name: true, requiresMfaAlways: true } } },
    });
    expect(assignments.map((a) => a.role.name)).toEqual(['PLATFORM_OPERATOR']);
    // FORCED, not offered — and it comes from a schema default rather than from anything this
    // module wrote, which is why it is asserted rather than assumed.
    expect(assignments[0].role.requiresMfaAlways).toBe(true);
  }, 300_000);

  it('CANNOT be signed into — the seeded password is unusable, not merely unknown', async () => {
    /*
     * The claim the seed makes is that no password exists. That cannot be shown by reading the
     * seed; it can only be shown by trying. The seed hashes 32 random bytes and discards the
     * plaintext in the same expression, so nothing anywhere can present it.
     */
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: PROVIDER_EMAIL, password: CHOSEN_PASSWORD })
      .expect(401);
  }, 300_000);

  it('SETS ITS OWN PASSWORD through the existing reset flow, and then signs in', async () => {
    // 1. Ask for a reset. The response shape is identical whether or not the address matched, so
    //    this endpoint cannot be used to discover that the provider account exists.
    const forgot = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: PROVIDER_EMAIL })
      .expect(200);

    const token = (forgot.body as { devResetToken?: string }).devResetToken;
    /*
     * `.env.test` sets ENABLE_DEV_RESET_TOKEN=true, which is how an e2e exercises the full flow
     * without a mailbox. Asserted rather than optional-chained into a skip: if the flag stops being
     * set, this test must FAIL rather than quietly stop proving anything.
     */
    expect(
      token,
      'no devResetToken — ENABLE_DEV_RESET_TOKEN must be true for this suite',
    ).toBeTruthy();

    // 2. Set a password. THIS TEST chooses it; the seed never knew one.
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, newPassword: CHOSEN_PASSWORD })
      .expect(200);

    // 3. The same credentials that were refused above now work — which is what proves step 2
    //    actually changed something rather than returning 200 and doing nothing.
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: PROVIDER_EMAIL, password: CHOSEN_PASSWORD })
      .expect(200);

    const body = login.body as {
      accessToken?: string;
      mfaRequired?: boolean;
      mfaEnrollmentRequired?: boolean;
    };
    // A token is issued; what the forced-MFA role then withholds is access to gated routes, which
    // the next test walks.
    expect(
      body.accessToken,
      'no access token after a successful reset',
    ).toBeTruthy();
  }, 300_000);

  it('IS REFUSED THE DASHBOARD UNTIL IT ENROLS, AND SEES IT AFTERWARDS', async () => {
    /*
     * The half that proves MFA is a real gate rather than a flag on a row. The operator holds
     * `provider.office-state.read` from the moment the seed runs — so if the dashboard were
     * reachable before enrolment, the forced-MFA attribute would be decoration.
     */
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: PROVIDER_EMAIL, password: CHOSEN_PASSWORD })
      .expect(200);
    const accessToken = (login.body as { accessToken: string }).accessToken;
    const bearer = `Bearer ${accessToken}`;

    const refused = await request(app.getHttpServer())
      .get('/provider/offices')
      .set('Authorization', bearer)
      .expect(403);
    // Named, so the reader is sent to enrolment rather than to whoever grants permissions.
    expect(JSON.stringify(refused.body)).toContain('MFA_ENROLLMENT_REQUIRED');

    // Enrol through the ordinary path — `@SkipMfaRequired()` is on these two routes precisely so a
    // user who must enrol can reach them. No second enrolment path exists, and none was built.
    const enroll = await request(app.getHttpServer())
      .post('/auth/mfa/totp/enroll')
      .set('Authorization', bearer)
      .expect(201);
    // Shape COPIED from `audit-actor-search.e2e-spec.ts`, not paraphrased: the response carries
    // `{ credentialId, otpAuthUri, qrCodeDataUrl }` and the secret is a query parameter inside the
    // URI — there is no `secret` field. This repo has already lost a run to inventing an auth
    // endpoint's shape from memory.
    const eb = enroll.body as { credentialId: string; otpAuthUri: string };
    const secret = /[?&]secret=([^&]+)/.exec(eb.otpAuthUri)![1];
    expect(secret, 'no TOTP secret in the otpauth URI').toBeTruthy();

    await request(app.getHttpServer())
      .post('/auth/mfa/totp/enroll/verify')
      .set('Authorization', bearer)
      .send({
        credentialId: eb.credentialId,
        code: authenticator.generate(secret),
      })
      .expect(200);

    // Sign in again: the session that existed before enrolment is not retroactively upgraded.
    const after = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: PROVIDER_EMAIL, password: CHOSEN_PASSWORD })
      .expect(200);
    // `mfaChallengeToken` and `/auth/mfa/totp/challenge/verify` — both copied from
    // `auth.e2e-spec.ts`. `/auth/mfa/verify` does not exist; inventing it was a 404 here, and the
    // same invention cost this repo a run once before.
    const challenge = after.body as {
      mfaRequired?: boolean;
      mfaChallengeToken?: string;
    };
    expect(
      challenge.mfaRequired,
      'MFA is not being demanded after enrolment',
    ).toBe(true);

    const verified = await request(app.getHttpServer())
      .post('/auth/mfa/totp/challenge/verify')
      .send({
        mfaChallengeToken: challenge.mfaChallengeToken,
        code: authenticator.generate(secret),
      })
      .expect(200);
    const finalToken = (verified.body as { accessToken: string }).accessToken;

    // THE WALK'S END: the dashboard the whole of item (j) built, opened by a real person.
    const offices = await request(app.getHttpServer())
      .get('/provider/offices')
      .set('Authorization', `Bearer ${finalToken}`)
      .expect(200);
    expect(Array.isArray(offices.body)).toBe(true);
    // Non-vacuity: an empty array would satisfy "200" while proving nothing about the cross-office
    // read, and db-test holds at least the default brokerage office.
    expect((offices.body as unknown[]).length).toBeGreaterThan(0);
  }, 300_000);
});
