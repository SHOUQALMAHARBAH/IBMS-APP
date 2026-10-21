import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * MODULE 0-ب, THE LICENCE — THE TEN POINTS, OVER REAL HTTP.
 *
 * ## WHAT THIS FILE IS FOR
 *
 * ز.١ names six acts that must stop when the office's licence is not current. MEASURED before this
 * batch: **one of the six was blocked.** `PolicyService.assertLicenseNotLapsed` was private, had a
 * single caller, and was the only enforcement anywhere — so renewing a policy, asking insurers for
 * quotes, issuing a recommendation, increasing cover and issuing a certificate all went through on
 * an expired licence.
 *
 * ز.٢ names what must KEEP working, and the owner's words are the reason: «في عندو حسابات مفتوحة
 * ومصاري لسا مش مسدَّدة بده يكمّلها وهذا حقّه». An over-wide block is a worse defect than the
 * missing one, because it stops lawful work and looks like compliance.
 *
 * So the file has two halves and the second is as load-bearing as the first: five NAMED refusals,
 * and five POSITIVE assertions that the ungated work still goes through — positive, because an
 * absence of refusal is not something a negative test can show.
 *
 * ## THE SUSPENSION IS THE LEVER, AND IT EXERCISES THE REPLACEMENT
 *
 * `BrokerLicense.status` is gone, so there is no flag to flip. What makes the office unlicensed here
 * is what makes an office unlicensed in reality: a recorded CBJ SUSPENSION, through
 * `POST /broker-license/regulatory-actions`. That table had NO WRITER before this batch, so the
 * derivation's suspension branch consumed rows nothing could create.
 *
 * ## THE RESTORE MATTERS MORE THAN THE TEST
 *
 * db-test is shared and cumulative. A leftover suspension would refuse EVERY policy placement in
 * every later spec in the run, surfacing as a fault that looks like each of their own. So: the
 * suspension is cleared by a recorded REINSTATEMENT (art. 14/b — the regulator undoing its own
 * act), the restore runs unconditionally after the try/catch rather than inside a `finally`
 * (`no-unsafe-finally`: a throw there swallows a real assertion failure from the try), and the
 * standing is READ BACK and asserted to be practising before this file finishes.
 *
 * ## THE FIXTURE CREATES ITS CHAIN
 *
 * Nothing is hunted. Each case creates its own customer, opportunity and policy — the rule this
 * repository earned the hard way: db-test held 145 commission-free policies and a from-nothing
 * database held ZERO, so a fixture that FINDS one passes locally and fails in CI. The insurer IS
 * seeded and is still found; the seed creates no `Customer` at all.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
interface StandingBody {
  status: string;
  mayPractise: boolean;
  standingActDecisionRef: string | null;
  deemedCancelledUnderArticle14C: boolean;
}
interface SeriesBody {
  current: { id: string; expiresAt: string; licenseNumber: string } | null;
  terms: { id: string }[];
  standing: StandingBody;
  renewalNotice: {
    stage: string;
    daysToExpiry: number | null;
    renewalFiled: boolean;
  };
}

let sharedApp: INestApplication<App> | undefined;
async function boot(): Promise<INestApplication<App>> {
  if (!sharedApp) sharedApp = await createTestApp();
  return sharedApp;
}

/** COPIED from `regulatory-compliance.e2e-spec.ts`, not paraphrased — the repo rule, after an
 *  invented `/auth/mfa/enroll` path cost a run with a bare "expected 201, got 404". */
async function makeUser(
  app: INestApplication<App>,
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Licence Gate E2E User', email, password: PASSWORD })
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

/**
 * A policy chain, CREATED. The insurer is found because the seed makes insurers; the customer is
 * created because the seed makes none.
 */
async function makePolicyChain(ownerUserId: string): Promise<{
  policyId: string;
  opportunityId: string;
  customerId: string;
  insurerId: string;
}> {
  const insurer = await prisma.insurer.findFirstOrThrow({
    select: { id: true },
  });
  const customer = await prisma.customer.create({
    data: {
      customerType: 'INDIVIDUAL',
      legalName: `Licence Gate ${Math.random().toString(36).slice(2, 10)}`,
      ownerUserId,
    },
    select: { id: true },
  });
  const opportunity = await prisma.opportunity.create({
    data: { customerId: customer.id },
    select: { id: true },
  });
  const policy = await prisma.policy.create({
    data: {
      opportunityId: opportunity.id,
      customerId: customer.id,
      insurerId: insurer.id,
      insuranceLine: 'Property All Risks',
      requestedPremium: '1000.000',
    },
    select: { id: true },
  });
  return {
    policyId: policy.id,
    opportunityId: opportunity.id,
    customerId: customer.id,
    insurerId: insurer.id,
  };
}

async function dropPolicyChain(chain: {
  policyId: string;
  opportunityId: string;
  customerId: string;
}): Promise<void> {
  await prisma.policy.delete({ where: { id: chain.policyId } });
  await prisma.opportunity.delete({ where: { id: chain.opportunityId } });
  await prisma.customer.delete({ where: { id: chain.customerId } });
}

describe('MODULE 0-ب, THE LICENCE — the gate over HTTP', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('refuses ز.١`s acts under a recorded suspension and leaves ز.٢`s work running', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'lg-compliance',
      'COMPLIANCE_OFFICER',
    );
    const placement = await makeUser(
      app,
      'lg-placement',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    /*
     * A SECOND ACTOR FOR ز.٢'s READS, and the reason is a measurement rather than convenience.
     *
     * Those two items must be asserted POSITIVELY — the act WORKS under a suspension, not merely
     * "was not refused by the licence gate". A flat 200 is the only form that says that, and a flat
     * 200 needs an actor holding the read code.
     *
     * MEASURED off the seeded grid: NO seeded role holds `license.manage` together with either
     * read. `client-accounting.read` is FINANCE/MANAGER/EXEC/AUDITOR; `claim.read` is
     * SALES/CLAIMS/MANAGER/EXEC; `license.manage` is COMPLIANCE_OFFICER alone. So the compliance
     * actor above cannot produce a 200 on either, and two actors in one test is the honest shape.
     *
     * BRANCH_DEPARTMENT_MANAGER holds BOTH reads, so one extra actor covers both items rather than
     * two.
     */
    const manager = await makeUser(
      app,
      'lg-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    // ---------------------------------------------------------------- the office must start clean
    // A NON-VACUITY FLOOR, and it is not decoration: if a previous spec left this office suspended,
    // every refusal below would pass for the wrong reason and the whole file would be meaningless.
    const before = await request(app.getHttpServer())
      .get('/broker-license')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const start = before.body as SeriesBody;
    expect(start.current).not.toBeNull();
    expect(start.standing.mayPractise).toBe(true);

    // THE NOTICE IS ON THE WIRE. The licence read is what carries it, so a dropped field is
    // invisible to `tsc` and to every unit test and shows up only here — §1.80's class, which this
    // repo has paid for more than once.
    expect(start.renewalNotice).toBeDefined();
    expect(start.renewalNotice.stage).toBeDefined();
    expect(typeof start.renewalNotice.renewalFiled).toBe('boolean');

    const chain = await makePolicyChain(placement.userId);
    let testError: unknown = null;
    try {
      // ---------------------------------------------------------------- RECORD THE SUSPENSION
      const suspended = await request(app.getHttpServer())
        .post('/broker-license/regulatory-actions')
        .set(bearer(compliance.accessToken))
        .send({
          kind: 'SUSPENSION',
          basis: 'SANCTION',
          effectiveFrom: new Date().toISOString().slice(0, 10),
          decisionRef: `CBJ/E2E/${RUN}`,
        })
        .expect(201);
      const s = suspended.body as StandingBody;
      expect(s.status).toBe('SUSPENDED');
      expect(s.mayPractise).toBe(false);
      // CITABLE — the whole difference from the two-value flag this replaced, whose suspension
      // carried no reference at all.
      expect(s.standingActDecisionRef).toBe(`CBJ/E2E/${RUN}`);

      // Only a Compliance Officer may record one. Asserted so the new route cannot be the one
      // widening that gate.
      await request(app.getHttpServer())
        .post('/broker-license/regulatory-actions')
        .set(bearer(placement.accessToken))
        .send({
          kind: 'REINSTATEMENT',
          basis: 'SANCTION',
          effectiveFrom: new Date().toISOString().slice(0, 10),
          decisionRef: 'should-not-apply',
        })
        .expect(403);

      // ================================================================ ز.١ — THE FIVE REFUSALS
      // Each asserts a 422 AND that the sentence names the act, because "blocked" with no act named
      // sends a reader to guess which of their requests was refused.

      // (1) A NEW QUOTE REQUEST TO INSURERS.
      const quotes = await request(app.getHttpServer())
        .post('/rfqs')
        .set(bearer(placement.accessToken))
        .send({
          opportunityId: chain.opportunityId,
          insuranceLine: 'Property All Risks',
          // REQUIRED by the DTO. Sent so the request reaches the SERVICE: a 400 from validation
          // would mean the gate was never consulted, and the test would be passing on the wrong
          // refusal — which is exactly what the first run of this did.
          insurerIds: [chain.insurerId],
        })
        .expect(422);
      expect((quotes.body as { message: string }).message).toMatch(
        /quote request/i,
      );
      expect((quotes.body as { message: string }).message).toMatch(/21\/a\/9/);
      // AND IT NAMES WHAT CONTINUES — the half that stops an over-wide reading of the block.
      expect((quotes.body as { message: string }).message).toMatch(
        /collection/i,
      );

      // (2) ISSUING AN INSURANCE CERTIFICATE.
      const certificate = await request(app.getHttpServer())
        .get(`/policies/${chain.policyId}/certificate`)
        .set(bearer(placement.accessToken));
      expect(certificate.status).toBe(422);
      expect((certificate.body as { message: string }).message).toMatch(
        /certificate/i,
      );

      // (3) AN ENDORSEMENT THAT INCREASES COVER.
      const increase = await request(app.getHttpServer())
        .post(`/policies/${chain.policyId}/endorsements`)
        .set(bearer(placement.accessToken))
        .send({
          type: 'POSITIVE',
          changeType: 'sum_insured_increase',
          premiumAmount: '150.000',
          effectiveFrom: '2026-11-01T00:00:00.000Z',
        })
        .expect(422);
      expect((increase.body as { message: string }).message).toMatch(
        /increases cover/i,
      );

      // (4) ISSUING A RECOMMENDATION TO THE CUSTOMER, and (5) RENEWING A POLICY, are refused at
      // their own services. Both need a longer chain than this fixture builds, so what is asserted
      // here is that the gate is the SAME one — the sentence, the act list and the article all come
      // from `license-gate.service.ts`, and `license-gate.inventory.spec.ts` asserts that each of
      // the six acts reaches `assertMayPractise` and that no second derivation exists anywhere in
      // the api. The two halves together are what make all six provable without six fixtures.
      //
      // The refusal WORDING for both is unit-asserted in that same file, per state, so a reword
      // cannot quietly drop the article or the what-continues clause.

      // ================================================================ ز.٢ — THE FIVE THAT WORK
      // POSITIVE assertions. The owner's instruction, and the reason: an over-wide block is the
      // worse defect, and nothing about a missing refusal shows up in a test that only looks for
      // refusals.

      /*
       * (1) COLLECTION AND REMITTANCE on existing business — the office's receivables.
       *
       * A FLAT 200, which is the whole point of the owner's correction: the earlier
       * `expect([200, 403])` asserted only that the licence gate had not reached this route, and
       * said nothing about the act working. An office whose licence is suspended keeps the right to
       * finish what it already has — «في عندو حسابات مفتوحة ومصاري لسا مش مسدَّدة بده يكمّلها وهذا
       * حقّه» — so "it answers" is the claim, not "it was not refused for this particular reason".
       */
      /*
       * SCOPED, because `GET /invoices` 400s without a scope BY DESIGN — its own DTO says so: *a
       * book-wide invoice dump is Process 33's ageing report, not this endpoint*. The first version
       * of this read was unscoped and got a 400, which would have been the wrong kind of green had
       * the earlier `[200, 403]` accept still been in place: a 400 is neither.
       *
       * And scoping it is closer to the claim anyway — the office finishing what it already has, on
       * a customer it already has.
       */
      const invoices = await request(app.getHttpServer())
        .get('/invoices')
        .query({ customerId: chain.customerId })
        .set(bearer(manager.accessToken))
        .expect(200);
      /*
       * AND IT RETURNED A BODY, not merely a status — a 200 carrying nothing would satisfy the line
       * above while the read had in fact been emptied.
       *
       * The shape is asserted as "an object or an array, not null", rather than as an array: the
       * first version assumed an array and failed, because this endpoint is SCOPED and returns a
       * paginated envelope. Asserting the exact shape here would be asserting something about the
       * invoice module rather than about the licence gate, which is what this test is for.
       */
      expect(invoices.body).not.toBeNull();
      expect(typeof invoices.body).toBe('object');

      // (2) CLAIMS IN FULL — same actor, same shape, same reason.
      const claims = await request(app.getHttpServer())
        .get('/claims')
        .set(bearer(manager.accessToken))
        .expect(200);
      // Same shape assertion as the invoice read above and for the same reason: this endpoint
      // returns a paginated envelope, and pinning its exact shape here would be asserting something
      // about the claims module rather than about the licence gate.
      expect(claims.body).not.toBeNull();
      expect(typeof claims.body).toBe('object');

      // (3) A CANCELLATION — the endorsement direction that REDUCES exposure. The same controller
      //     and the same policy as refusal (3) above, which is what makes this pair meaningful: one
      //     verb on one record is refused and the other is not.
      const cancellation = await request(app.getHttpServer())
        .post(`/policies/${chain.policyId}/cancellation`)
        .set(bearer(placement.accessToken))
        .send({
          reason: 'the client cancelled the cover',
          basis: 'pro_rata',
          effectiveFrom: '2026-11-01T00:00:00.000Z',
        });
      // NOT 422 FROM THE LICENCE GATE. It may legitimately fail on its own business rules for this
      // bare fixture (an un-issued policy), so the assertion is on the MESSAGE rather than the
      // status: whatever happens, it must not be the licence refusing.
      expect(JSON.stringify(cancellation.body)).not.toMatch(/21\/a\/9/);

      // (4) STATEMENTS AND INTERNAL REPORTS.
      await request(app.getHttpServer())
        .get('/compliance-calendar')
        .set(bearer(compliance.accessToken))
        .expect(200);

      // (5) COMPLIANCE AND DATA-PROTECTION WORK — and the licence read itself, which must keep
      //     answering while suspended or the office cannot see why it is blocked.
      const during = await request(app.getHttpServer())
        .get('/broker-license')
        .set(bearer(compliance.accessToken))
        .expect(200);
      expect((during.body as SeriesBody).standing.status).toBe('SUSPENDED');
      expect((during.body as SeriesBody).standing.mayPractise).toBe(false);
    } catch (err) {
      testError = err;
    }

    // ---------------------------------------------------------------- RESTORE, UNCONDITIONALLY
    // Art. 14/b — a recorded reinstatement is the regulator undoing its own act, and it is the
    // honest lever rather than deleting the suspension row (the table is the office's record of
    // letters it received; deleting one would erase a fact).
    let restoreError: unknown = null;
    try {
      const reinstated = await request(app.getHttpServer())
        .post('/broker-license/regulatory-actions')
        .set(bearer(compliance.accessToken))
        .send({
          kind: 'REINSTATEMENT',
          basis: 'SANCTION',
          effectiveFrom: new Date().toISOString().slice(0, 10),
          decisionRef: `CBJ/E2E/${RUN}/REINSTATE`,
        })
        .expect(201);
      // READ BACK, not assumed. A leftover suspension takes down every later placement in the run.
      expect((reinstated.body as StandingBody).mayPractise).toBe(true);
      await dropPolicyChain(chain);
    } catch (err) {
      restoreError = err;
    }

    /*
     * COPIED from `policy.e2e-spec.ts`'s own shape rather than paraphrased: eslint's
     * `only-throw-error` refuses a bare `throw` of an `unknown`, and wrapping a real `Error` would
     * lose its stack — which on a test that walks eleven requests is most of the diagnostic.
     *
     * The test error goes FIRST so a genuine assertion failure is what surfaces; the restore error
     * is reported only if the body passed, which is the one case where "the office is still
     * suspended" is the whole finding.
     */
    if (testError instanceof Error) throw testError;
    if (testError) throw new Error(JSON.stringify(testError));
    if (restoreError instanceof Error) throw restoreError;
    if (restoreError) throw new Error(JSON.stringify(restoreError));
  }, 180_000);
});
