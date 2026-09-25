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
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';
import { makeInsurer } from './insurer-fixture';

/**
 * PART 4 STEP 3 — one person performing both halves, through the real HTTP API, in an office that has
 * declared COMBINED mode.
 *
 * `Refund.approve` is the pair wired first. It is the sharpest of the fifteen: the refund exists because a
 * negative endorsement moved money, and the second signature is the only thing standing between "the broker
 * decided to return premium" and "the broker returned premium to themselves".
 *
 * ## THE MODE IS CHANGED WITH A COMMITTED WRITE, AND THAT IS UNAVOIDABLE HERE
 *
 * The schema-level spec proves its claims inside a rolled-back transaction, which is strictly safer. It
 * cannot work here: the mode has to be readable by the API process handling an HTTP request, which is not
 * inside this test's transaction. So the mode is set, used, and reset in a `finally`, AND forced back to
 * SEGREGATED in both `beforeAll` and `afterAll` — the same both-ends discipline
 * `insurer-schema-constraints.e2e-spec.ts` uses for its second Organization, and for the same reason: a
 * killed run must not leave the shared database in a state where a self-approval is legitimate.
 *
 * The acts this spec writes are deliberately LEFT BEHIND. They are legitimate history — an act recorded while
 * the office was COMBINED — and deleting them would mean nulling the escape column on a refund first, which
 * is mutating evidence to tidy a test database. Every assertion here is scoped to this run's own ids.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 8);

let sharedApp: INestApplication<App> | undefined;

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface QuotationChainBody {
  current: { id: string };
}
interface EndorsementBody {
  id: string;
  status: string;
  premiumAdjustment: string;
  refund: { id: string; needsApproval: boolean; raisedByUserId: string } | null;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function uniqueEmail(label: string): string {
  return `${label}-${RUN}-${Date.now()}@ibms.test`;
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

/** SEGREGATED, whatever a killed run left behind. Called at both ends. */
async function forceSegregated(): Promise<void> {
  await rawPrisma.organization.update({
    where: { id: TEST_ORGANIZATION_ID },
    data: { dutySegregationMode: 'SEGREGATED' },
  });
}

/** Declares COMBINED for the duration of `work`, and puts it back whatever happens. */
async function inCombinedMode<T>(work: () => Promise<T>): Promise<T> {
  await rawPrisma.organization.update({
    where: { id: TEST_ORGANIZATION_ID },
    // Only the mode. The declaration columns (`declaredAt`/`declaredByUserId`) are step 4's audited path,
    // and writing them here would make this spec look like the feature that sets them.
    data: { dutySegregationMode: 'COMBINED' },
  });
  try {
    return await work();
  } finally {
    await forceSegregated();
  }
}

async function makeUser(
  app: INestApplication<App>,
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Combined Duty E2E User', email, password: PASSWORD })
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
  const eb = enroll.body as MfaEnrollBody;
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: eb.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(eb.otpAuthUri)),
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

const SCHEDULE = {
  limits: { buildings: '5000000.000' },
  sumsInsured: { total: '5000000.000' },
  namedPerils: ['fire'],
  extensions: [],
};
const FACTORS = {
  coverage: 'Matches every requested peril plus the two extensions.',
  price: 'Lowest premium of the shortlist.',
  financialStrength: 'A- rated carrier, adequate for this exposure.',
  claimsService: 'Local adjuster panel, ten-day average settlement.',
  deductible: 'JOD 1,000, in line with the market for this class.',
  policyConditions: 'No unusual warranties; standard subrogation clause.',
};

/**
 * A refund awaiting approval, raised by `token`'s own user.
 *
 * The whole chain, because the maker id that matters is `Refund.raisedByUserId`, which is stamped by whoever
 * calls `calculate-adjustment`. Constructing the refund row directly would prove nothing about the path a
 * self-approval actually takes.
 */
async function refundAwaitingApproval(
  app: INestApplication<App>,
  token: string,
  checkerToken: string,
  ownerUserId: string,
  tag: string,
): Promise<{
  refundId: string;
  endorsementId: string;
  raisedByUserId: string;
}> {
  const rand = Math.random().toString(36).slice(2, 8);
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `Combined Duty ${tag} ${rand}`,
      ownerUserId,
    },
  });
  const riskProfile = await prisma.riskProfile.create({
    data: { customerId: customer.id, siteLabel: 'HQ' },
  });
  const program = await prisma.insuranceProgram.create({
    data: { riskProfileId: riskProfile.id, status: 'FINALIZED' },
  });
  const opportunity = await prisma.opportunity.create({
    data: {
      customerId: customer.id,
      insuranceProgramId: program.id,
      status: 'COMPARISON_BUILT',
    },
  });
  const rfq = await prisma.rFQ.create({
    data: {
      opportunityId: opportunity.id,
      insuranceLine: 'Property All Risks',
    },
  });
  const insurer = await makeInsurer(`Combined Duty ${tag} ins ${rand}`);
  await prisma.rFQInsurer.create({
    data: { rfqId: rfq.id, insurerId: insurer.id, status: 'SENT' },
  });

  const quote = await request(app.getHttpServer())
    .post('/quotations')
    .set(bearer(token))
    .send({
      rfqId: rfq.id,
      insurerId: insurer.id,
      premium: '120000.000',
      commissionRatePercent: '12',
    })
    .expect(201);
  const drafted = await request(app.getHttpServer())
    .post('/recommendations')
    .set(bearer(token))
    .send({
      opportunityId: opportunity.id,
      recommendedQuotationId: (quote.body as QuotationChainBody).current.id,
      rationale: 'A long enough written summary to pass the length check.',
      rationaleFactors: FACTORS,
    })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/recommendations/${(drafted.body as { id: string }).id}/send`)
    .set(bearer(token))
    .expect(201);
  await request(app.getHttpServer())
    .post('/client-decisions')
    .set(bearer(token))
    .send({
      opportunityId: opportunity.id,
      decision: 'ACCEPT',
      evidenceType: 'e-signature',
      evidenceRef: `env-${tag}-${rand}`,
    })
    .expect(201);

  const placed = await request(app.getHttpServer())
    .post('/policies')
    .set(bearer(token))
    .send({
      opportunityId: opportunity.id,
      inceptionDate: '2026-10-01',
      expiryDate: '2027-10-01',
    })
    .expect(201);
  const policyId = (placed.body as { id: string }).id;
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/issuance`)
    .set(bearer(token))
    .send({
      policyNumber: `POL-CD-${Date.now()}-${rand}`,
      issuedPremium: '120000.000',
      schedule: SCHEDULE,
      documents: [],
    })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/checking`)
    .set(bearer(checkerToken))
    .send({ requestedCoverage: SCHEDULE })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/delivery`)
    .set(bearer(token))
    .send({ method: 'courier', recipient: 'Acme Risk Dept' })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/delivery/acknowledge-receipt`)
    .set(bearer(token))
    .send({})
    .expect(201);

  const requested = await request(app.getHttpServer())
    .post(`/policies/${policyId}/endorsements`)
    .set(bearer(token))
    .send({
      type: 'NEGATIVE',
      changeType: 'remove_vehicle',
      premiumAmount: '9000.000',
      effectiveFrom: '2026-12-01',
    })
    .expect(201);
  const endorsementId = (requested.body as EndorsementBody).id;
  for (let i = 0; i < 2; i += 1) {
    await request(app.getHttpServer())
      .post(`/endorsements/${endorsementId}/advance`)
      .set(bearer(token))
      .send({})
      .expect(201);
  }
  const calculated = await request(app.getHttpServer())
    .post(`/endorsements/${endorsementId}/calculate-adjustment`)
    .set(bearer(token))
    .send({})
    .expect(201);
  const body = calculated.body as EndorsementBody;
  expect(body.status).toBe('REFUND_APPROVAL_PENDING');
  expect(body.refund?.needsApproval).toBe(true);
  return {
    refundId: body.refund?.id as string,
    endorsementId,
    raisedByUserId: body.refund?.raisedByUserId as string,
  };
}

describe('duty segregation — a declared combined act through the API (e2e)', () => {
  beforeAll(async () => {
    // Before anything asserts on it: whatever a killed run left behind.
    await forceSegregated();
    sharedApp = await createTestApp();
  }, 300_000);

  afterAll(async () => {
    await sharedApp?.close();
    sharedApp = undefined;
    await forceSegregated();
  });

  it('SEGREGATED: the raiser cannot approve their own refund, and the refusal names the way forward', async () => {
    const app = sharedApp as INestApplication<App>;
    const one = await makeUser(
      app,
      'cd-seg',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
      // Holds `refund.approve`, so the refusal below is about SEGREGATION and not about the permission —
      // which is the distinction plant 4 at the bottom of this file turns around.
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const chk = await makeUser(app, 'cd-seg-chk', 'POLICY_CHECKING_OFFICER');
    const { refundId } = await refundAwaitingApproval(
      app,
      one.accessToken,
      chk.accessToken,
      one.userId,
      'seg',
    );

    const refused = await request(app.getHttpServer())
      .post(`/refunds/${refundId}/approve`)
      .set(bearer(one.accessToken))
      .send({})
      .expect(403);
    const message = JSON.stringify(refused.body);
    expect(message).toContain('segregation of duties');
    // Part 5's honesty fix, routed through the new engine: the remedy names the permission and where to see
    // who holds it. A refusal that only states the rule leaves the holder with nothing to do.
    expect(message).toContain('refund.approve');
    expect(message).toContain('Roles & permissions');

    // And a reason does NOT buy a way through in a segregated office.
    await request(app.getHttpServer())
      .post(`/refunds/${refundId}/approve`)
      .set(bearer(one.accessToken))
      .send({
        combinedDutyReason: 'I am the only person in this office today.',
      })
      .expect(403);

    const stored = await rawPrisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: { approvedByUserId: true, combinedDutyActId: true },
    });
    expect(stored.approvedByUserId).toBeNull();
    expect(stored.combinedDutyActId).toBeNull();
  }, 600_000);

  it('COMBINED: the same person approves once they say why, and the act records the pair, the reason and the hat', async () => {
    const app = sharedApp as INestApplication<App>;
    const one = await makeUser(
      app,
      'cd-comb',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const chk = await makeUser(app, 'cd-comb-chk', 'POLICY_CHECKING_OFFICER');
    const { refundId, raisedByUserId } = await refundAwaitingApproval(
      app,
      one.accessToken,
      chk.accessToken,
      one.userId,
      'comb',
    );
    expect(raisedByUserId).toBe(one.userId);

    const REASON =
      'The owner is the only person in this office and the client is waiting on the refund.';

    await inCombinedMode(async () => {
      // WITHOUT a reason the mode changes nothing. This is the assertion that separates "declared" from
      // "allowed": an office in COMBINED mode has not thereby switched the control off.
      const noReason = await request(app.getHttpServer())
        .post(`/refunds/${refundId}/approve`)
        .set(bearer(one.accessToken))
        .send({})
        .expect(422);
      expect(JSON.stringify(noReason.body)).toContain('reason');

      // A reason too short for anybody to act on is refused by the DTO, before the service.
      await request(app.getHttpServer())
        .post(`/refunds/${refundId}/approve`)
        .set(bearer(one.accessToken))
        .send({ combinedDutyReason: 'because' })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/refunds/${refundId}/approve`)
        .set(bearer(one.accessToken))
        .send({ combinedDutyReason: REASON })
        .expect(201);
    });

    // READ THE STORED ROWS, not the response. The claim is that the database accepted a self-approval it
    // refuses by default, and that the act explaining it exists.
    const stored = await rawPrisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: {
        raisedByUserId: true,
        approvedByUserId: true,
        combinedDutyActId: true,
      },
    });
    expect(stored.approvedByUserId).toBe(one.userId);
    expect(stored.raisedByUserId).toBe(one.userId);
    expect(stored.combinedDutyActId).not.toBeNull();

    const act = await rawPrisma.combinedDutyAct.findUniqueOrThrow({
      where: { id: stored.combinedDutyActId as string },
    });
    expect(act.entity).toBe('Refund');
    expect(act.entityId).toBe(refundId);
    // Named by the CONSTRAINT it excuses, so the act and the database rule cannot drift apart.
    expect(act.constraintName).toBe('Refund_maker_checker_distinct');
    expect(act.actorUserId).toBe(one.userId);
    expect(act.reason).toBe(REASON);
    expect(act.organizationId).toBe(TEST_ORGANIZATION_ID);
    // THE HAT: the roles that actually grant `refund.approve`, not every role the actor held. This actor
    // holds three roles and only one of them is a checker for this pair.
    expect(act.actorRoleIds.length).toBe(3);
    expect(act.grantingRoleNames).toContain('BRANCH_DEPARTMENT_MANAGER');
    expect(act.grantingRoleNames).not.toContain('PLACEMENT_TECHNICAL_OFFICER');
    expect(act.multipleGrantingRoles).toBe(false);
  }, 600_000);

  it('COMBINED does not grant the permission: without refund.approve it is still 403 (plan plant 4)', async () => {
    const app = sharedApp as INestApplication<App>;
    // PLACEMENT raises refunds and does NOT hold `refund.approve`. The mode makes a self-approval
    // DECLARABLE; it does not hand anybody a capability. If this ever returns 201, COMBINED mode has become
    // a permission grant, which is the one thing the design promises it is not.
    const raiser = await makeUser(
      app,
      'cd-noperm',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'cd-noperm-chk', 'POLICY_CHECKING_OFFICER');
    const { refundId } = await refundAwaitingApproval(
      app,
      raiser.accessToken,
      chk.accessToken,
      raiser.userId,
      'noperm',
    );

    await inCombinedMode(async () => {
      const refused = await request(app.getHttpServer())
        .post(`/refunds/${refundId}/approve`)
        .set(bearer(raiser.accessToken))
        .send({
          combinedDutyReason:
            'Declaring it does not help: this account cannot approve refunds at all.',
        })
        .expect(403);
      // The refusal must be about the PERMISSION, not about segregation — otherwise the message would tell
      // this person to find a second signature when what they actually need is the code.
      expect(JSON.stringify(refused.body)).not.toContain('segregation');
    });

    const stored = await rawPrisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: { approvedByUserId: true, combinedDutyActId: true },
    });
    expect(stored.approvedByUserId).toBeNull();
    expect(stored.combinedDutyActId).toBeNull();
  }, 600_000);

  it('the office is SEGREGATED again once this file is done', async () => {
    // Explicit rather than trusted. Every other spec in the run reads this office, and one left in COMBINED
    // mode would make a self-approval legitimate for all of them — a failure that would surface as an
    // unrelated assertion somewhere else entirely.
    const office = await rawPrisma.organization.findUniqueOrThrow({
      where: { id: TEST_ORGANIZATION_ID },
      select: { dutySegregationMode: true },
    });
    expect(office.dutySegregationMode).toBe('SEGREGATED');
  }, 120_000);
});
