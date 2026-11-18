import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, ensureRole, TEST_ORGANIZATION_ID } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';
import { RENEWAL_AWAITING_DECLARATION_REFUSAL_AR } from '../src/modules/compliance-risk/license-gate.service';

/**
 * THE OFFICE PAST EXPIRY THAT FILED, PROVED IT, AND HAS NOT DECLARED — over real HTTP.
 *
 * ## What this proves, and why the demo needs it proven
 *
 * Message 46 §2.2 puts the demo's SECOND office into exactly this state so a presenter can show
 * the refusal, then create a role, grant `license-renewal.declare` in front of the brokers,
 * assign it and declare — and watch issuance open. That demonstration is worth nothing if the
 * state it rests on is not the state the product actually produces, so this file drives the
 * state through the real routes and asserts the two things the demonstration turns on:
 *
 *   1. an issuance act is refused with OWNER DECISION 136(ب)'s own sentence — not «your licence
 *      expired», which is true and useless, but what is missing and who to see;
 *   2. NO ROLE holds `license-renewal.declare` — OWNER DECISION 131, and DECISION 151 ruling 6
 *      extends it to the demo data: «لا يُزرَع دور يحملها». If a seeded role held the code there
 *      would be nothing to grant and nothing to show.
 *
 * ## 🔴 `BrokerLicense` IS NOT A SINGLETON HERE — db-test HOLDS 51 TERMS, MEASURED
 *
 * The first version of this file moved ONE term's expiry into the past and expected the office to
 * be past expiry. It is not: measured 2026-11-18, db-test holds **51 `BrokerLicense` rows for the
 * one office**, expiring out to 2105, and `pickCurrentTerm` simply picks the next one. The filing
 * then landed on a DIFFERENT term from the one the restore put back — residue that made the second
 * run fail with a 409 on a write-once route, which is how it was found.
 *
 * ⟶ So the whole SERIES is shifted by one interval and shifted back by the same one. Two
 * statements, exactly reversible, and the relative order of all 51 terms is preserved — which
 * matters, because `pickCurrentTerm` is what decides which term the filing lands on. DAYS rather
 * than years: Postgres clamps a Feb-29 date to Feb 28 when the target year is not a leap year, so
 * a year interval is NOT exactly reversible and a day interval is. The interval itself is
 * DERIVED from the data rather than fixed — see `shiftDaysFor`, and the CI-only incoherence a
 * fixed hundred years would have produced on a from-empty database.
 *
 * Every later spec in the run reads this series. A series left in the past would refuse every
 * policy placement, every quote request and every certificate in the whole suite, surfacing as a
 * fault that looks like each of their own. So:
 *
 *   * the shift is undone with the same interval, and the renewal columns this test writes are
 *     cleared by their own reference number rather than by a remembered id;
 *   * the restore runs UNCONDITIONALLY after the try/catch rather than in a `finally` — a throw
 *     inside `finally` swallows a real assertion failure (`no-unsafe-finally`), which is the
 *     shape `license-gate.e2e-spec.ts` already learned here;
 *   * the standing is READ BACK and asserted practising before the file finishes.
 *
 * ## The expiry is moved through Prisma, and that is deliberate rather than a shortcut
 *
 * There is no route that expires a licence and there must not be: a term expires by the passage
 * of time, not by anybody's act, and an endpoint that could expire one on demand would be a way
 * to switch an office off. The FILING and its proof go through the real
 * `POST /broker-license/renewal-requested` on the real `license.manage` permission, because that
 * is an act somebody performs.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DECLARE_CODE = 'license-renewal.declare';

/** How far past its expiry the office should land. */
const PAST_EXPIRY_DAYS = 30;

/**
 * 🔴 THE SHIFT IS DERIVED FROM THE DATA, NOT A FIXED HUNDRED YEARS.
 *
 * The first version subtracted a flat 36,525 days, which works on THIS machine — db-test is
 * cumulative and its 51 terms run out to 2105 — and is wrong in CI, which builds from empty.
 * There the base seed writes ONE term, `issuedAt` 1 January this year and `expiresAt` 31
 * December two years on; a hundred-year shift would leave it issued in 2026 and expiring in
 * 1928. No CHECK refuses that (measured: `BrokerLicense` carries one CHECK and it is about the
 * renewal proof), but a term whose issuance follows its expiry is incoherent data, and a
 * derivation that behaved differently on it would do so ONLY in CI — which is the one place
 * this cannot be iterated on cheaply.
 *
 * ⟶ So the shift is whatever puts the LATEST expiry {@link PAST_EXPIRY_DAYS} in the past, and
 * BOTH date columns move by it: every term stays internally coherent, the series keeps its
 * order (which is what `pickCurrentTerm` reads), and the restore adds back the same integer.
 *
 * ⛔ DAYS, never `interval 'N years'`: Postgres clamps 29 February to the 28th when the target
 * year is not a leap year, so a year interval is not exactly reversible and this restore has to
 * be.
 */
function shiftDaysFor(latestExpiry: Date): number {
  const target = Date.now() - PAST_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Math.ceil((latestExpiry.getTime() - target) / (24 * 60 * 60 * 1000));
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function uniqueEmail(label: string): string {
  return `${label}-${RUN}@ibms.test`;
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
interface SeriesBody {
  current: { id: string; expiresAt: string } | null;
  standing: { status: string; mayPractise: boolean };
}

let sharedApp: INestApplication<App> | undefined;
async function boot(): Promise<INestApplication<App>> {
  if (!sharedApp) sharedApp = await createTestApp();
  return sharedApp;
}

/** COPIED from `license-gate.e2e-spec.ts`, not paraphrased — the repo rule, after an invented
 *  `/auth/mfa/enroll` path once cost a run with a bare "expected 201, got 404". */
async function makeUser(
  app: INestApplication<App>,
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({
      fullName: 'Renewal Declaration E2E User',
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

describe('an office past expiry that filed and has not declared', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
  });

  it('refuses an issuance act with decision 136(ب)’s sentence, and no role holds the code', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'renewal-compliance',
      'COMPLIANCE_OFFICER',
    );
    const placement = await makeUser(
      app,
      'renewal-placement',
      'PLACEMENT_TECHNICAL_OFFICER',
    );

    // ------------------------------------------------- the office must start practising
    // NON-VACUITY FLOOR. If an earlier spec left this office unable to practise, the refusal
    // below would pass for the wrong reason and prove nothing at all.
    const before = await request(app.getHttpServer())
      .get('/broker-license')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const start = before.body as SeriesBody;
    expect(start.current).not.toBeNull();
    expect(start.standing.mayPractise).toBe(true);

    // The chain the refused act needs. Created, never hunted: db-test is cumulative and a
    // fixture that FINDS a row passes locally and fails from an empty database.
    const insurer = await prisma.insurer.findFirstOrThrow({
      select: { id: true },
    });
    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: `Renewal Declaration ${RUN}`,
        ownerUserId: placement.userId,
      },
      select: { id: true },
    });
    const opportunity = await prisma.opportunity.create({
      data: { customerId: customer.id },
      select: { id: true },
    });

    // The shift, computed from what is actually there. db-test holds 51 terms running to 2105;
    // a from-empty CI database holds ONE expiring two years out. Both land 30 days past expiry.
    const latest = await prisma.brokerLicense.findFirstOrThrow({
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    });
    const shiftDays = shiftDaysFor(latest.expiresAt);
    expect(
      shiftDays,
      'the series is already past expiry — nothing to shift',
    ).toBeGreaterThan(0);

    let proofDocumentId: string | undefined;
    let testError: unknown = null;
    try {
      // -------------------------------------------------------- past expiry, filed, proved
      //
      // The WHOLE SERIES moves. See this file's header: expiring one term only promotes the
      // next, and db-test holds 51 of them. `$executeRawUnsafe` because this is a relative
      // column-to-column update Prisma's typed API cannot express; scoped to the one office
      // explicitly, since raw SQL does not go through `tenantScopeExtension`.
      await prisma.$executeRawUnsafe(
        `UPDATE "BrokerLicense" SET "expiresAt" = "expiresAt" - interval '${shiftDays} days', ` +
          `"issuedAt" = "issuedAt" - interval '${shiftDays} days' WHERE "organizationId" = $1`,
        TEST_ORGANIZATION_ID,
      );

      // The office must now be past expiry, with NOTHING filed — the state before the office
      // does anything about it. Read back rather than assumed: this is what the shift was for.
      const expired = await request(app.getHttpServer())
        .get('/broker-license')
        .set(bearer(compliance.accessToken))
        .expect(200);
      const expiredBody = expired.body as SeriesBody;
      expect(expiredBody.current).not.toBeNull();
      expect(expiredBody.standing.mayPractise).toBe(false);
      expect(new Date(expiredBody.current!.expiresAt).getTime()).toBeLessThan(
        Date.now(),
      );

      // Art. 11 measures its 45 days from THIS term's expiry, so the filing date is computed
      // from the shifted expiry rather than from today — 60 days before it, which is on time
      // under any legal figure up to 60.
      const shiftedExpiry = new Date(expiredBody.current!.expiresAt);
      const filedAt = new Date(
        shiftedExpiry.getTime() - 60 * 24 * 60 * 60 * 1000,
      );

      const proof = await prisma.document.create({
        data: {
          category: 'CORRESPONDENCE',
          classification: 'INTERNAL',
          fileName: `renewal-filing-proof-${RUN}.pdf`,
          storageRef: `e2e/${RUN}/renewal-filing-proof`,
          uploadedByUserId: compliance.userId,
        },
        select: { id: true },
      });
      proofDocumentId = proof.id;

      await request(app.getHttpServer())
        .post('/broker-license/renewal-requested')
        .set(bearer(compliance.accessToken))
        .send({
          requestedAt: filedAt.toISOString().slice(0, 10),
          proofDocumentId: proof.id,
          referenceNumber: `CBJ-IN-E2E-${RUN}`,
        })
        .expect(201);

      // ------------------------------------------------------------------ the refusal
      const refused = await request(app.getHttpServer())
        .post('/rfqs')
        .set(bearer(placement.accessToken))
        .send({
          opportunityId: opportunity.id,
          insuranceLine: 'Property All Risks',
          insurerIds: [insurer.id],
        })
        .expect(422);

      const message = (refused.body as { message?: string }).message ?? '';
      // HER SENTENCE, BYTE FOR BYTE. Imported from the one place it lives rather than retyped:
      // a copy here would agree with the implementation right up until somebody edited one.
      expect(message).toBe(RENEWAL_AWAITING_DECLARATION_REFUSAL_AR);
      // AND IT DOES NOT SAY «ساري» OR «حكماً» — decision 128 §4. The licence IS expired; the
      // state word is «قيد التجديد», and claiming otherwise would have the system assert
      // something art. 21/a/9 contradicts.
      expect(message).not.toContain('ساري');
      expect(message).not.toContain('حكماً');

      // -------------------------------------------- and NOBODY holds the declaration code
      // OWNER DECISION 131, extended to demo data by DECISION 151 ruling 6. This is what makes
      // the refusal above the start of a demonstration rather than a dead end: the office's own
      // administrator grants the code, live.
      const holders = await prisma.rolePermission.findMany({
        where: { permission: { code: DECLARE_CODE } },
        select: { roleId: true },
      });
      expect(holders).toHaveLength(0);

      // NON-VACUOUS: the code must EXIST, or the assertion above passes because nothing is
      // named that — which is the shape rule 12 exists to refuse.
      const permission = await prisma.permission.findUnique({
        where: { code: DECLARE_CODE },
        select: { id: true },
      });
      expect(permission).not.toBeNull();
    } catch (err) {
      testError = err;
    }

    // ---------------------------------------------------------------------- RESTORE
    // Unconditional, and NOT in a `finally`: a throw there swallows a genuine assertion failure.
    let restoreError: unknown = null;
    try {
      // Clear what THIS run filed, found by its own reference number rather than by a
      // remembered id — the filing lands on whichever term `pickCurrentTerm` chose, which is
      // exactly the thing the first version of this file got wrong.
      await prisma.brokerLicense.updateMany({
        where: { renewalReferenceNumber: `CBJ-IN-E2E-${RUN}` },
        data: {
          renewalRequestedAt: null,
          renewalProofDocumentId: null,
          renewalReferenceNumber: null,
        },
      });
      // The same interval, back. Exactly reversible by construction.
      await prisma.$executeRawUnsafe(
        `UPDATE "BrokerLicense" SET "expiresAt" = "expiresAt" + interval '${shiftDays} days', ` +
          `"issuedAt" = "issuedAt" + interval '${shiftDays} days' WHERE "organizationId" = $1`,
        TEST_ORGANIZATION_ID,
      );
      if (proofDocumentId) {
        // The term no longer points at it, so `onDelete: Restrict` is satisfied. Left behind it
        // would be an orphan proof in a table an inspector reads.
        await prisma.document.delete({ where: { id: proofDocumentId } });
      }
      const after = await request(app.getHttpServer())
        .get('/broker-license')
        .set(bearer(compliance.accessToken))
        .expect(200);
      expect((after.body as SeriesBody).standing.mayPractise).toBe(true);
    } catch (err) {
      restoreError = err;
    }

    // The TEST error first, so a real failure is what surfaces; the restore error only if the
    // test itself passed, because a failed restore poisons every later spec in the run.
    if (testError instanceof Error) throw testError;
    if (testError) throw new Error(JSON.stringify(testError));
    if (restoreError instanceof Error) throw restoreError;
    if (restoreError) throw new Error(JSON.stringify(restoreError));
  }, 120_000);
});
