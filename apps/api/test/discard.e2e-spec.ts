import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';
import { makeInsurer } from './insurer-fixture';

/**
 * DISCARD — a record raised in error, withdrawn before it took effect.
 *
 * ## What this file has to prove, and why each part is here
 *
 * Measured before building: there was no route out of any pre-commitment state in four modules. The sharpest
 * case is the endorsement, where the only exit from a wrongly raised one was to APPLY it — changing a real
 * policy, its premium and its commission — and then correct it with a second endorsement. **To undo the
 * mistake you had to commit it first.**
 *
 *  1. Each of the four can be created, discarded with a reason, and READ BACK — still present, marked
 *     discarded, carrying actor, timestamp and reason. Read back from the API, not inferred from a 201.
 *  2. A discarded record cannot advance. Every forward move refuses it, and the refusal NAMES the discard —
 *     a status error would send the reader looking for a status problem that is not there.
 *  3. A committed record cannot be discarded: an issued policy, a registered claim, a sent recommendation,
 *     an applied endorsement — each refused, each naming its own point of no return.
 *  4. THE ENDORSEMENT TRAP IS GONE: raise one wrongly, discard it, and the policy, its premium, its schedule
 *     and its commission are untouched — read back from the database, never inferred from the absence of an
 *     error.
 *  5. Discard is its OWN permission. No seeded role separates `policy.discard` from `policy.create` (both
 *     went to the same roles by design, so nobody lost a capability), so a seeded account cannot observe the
 *     split at all — the same trap § 1.51(d) recorded on the vendor codes. Each case here builds a role
 *     holding exactly the codes named.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 10);
const REASON = 'Raised against the wrong customer during data entry.';

let sharedApp: INestApplication<App> | undefined;
const createdRoleIds: string[] = [];

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
interface QuotationChainBody {
  current: { id: string };
}
interface DiscardBlock {
  at: string;
  byUserId: string;
  reason: string;
}
interface DiscardableBody {
  id: string;
  status?: string;
  discard: DiscardBlock | null;
}
interface PolicyBody extends DiscardableBody {
  status: string;
  issuedPremium: string | null;
  schedules: { id: string }[];
}

async function boot(): Promise<INestApplication<App>> {
  if (!sharedApp) sharedApp = await createTestApp();
  return sharedApp;
}

/** Signup + login + TOTP enrolment, then the named seeded roles. */
async function makeUser(
  app: INestApplication<App>,
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Discard E2E User', email, password: PASSWORD })
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

/**
 * A signed-in user holding a role with EXACTLY these codes.
 *
 * Proof 5 cannot use a seeded account: every role that can create one of these records was granted the
 * matching discard code deliberately, so `policy.create` and `policy.discard` always arrive together and a
 * seeded token could not tell a route gated on one from a route gated on the other.
 */
async function actorHolding(
  app: INestApplication<App>,
  label: string,
  codes: string[],
): Promise<{ accessToken: string; userId: string }> {
  const org = await prisma.organization.findFirstOrThrow({
    orderBy: { id: 'asc' },
  });
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  // A mistyped code would grant nothing and make every refusal below pass for the wrong reason.
  expect(permissions.map((p) => p.code).sort()).toEqual([...codes].sort());

  const role = await prisma.role.create({
    data: {
      organizationId: org.id,
      name: `${label.toUpperCase()}_${RUN}`,
      nameEn: label,
      nameAr: label,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
      permissions: {
        create: permissions.map((p) => ({
          organizationId: org.id,
          permissionId: p.id,
        })),
      },
    },
    select: { id: true },
  });
  createdRoleIds.push(role.id);

  const email = `${label}-${RUN}@discard.test`;
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Discard ${label}`, email, password: PASSWORD })
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

  await prisma.userRoleAssignment.create({
    data: { userId: user.id, roleId: role.id },
  });
  return { accessToken, userId: user.id };
}

const ISSUED_SCHEDULE = {
  limits: { buildings: '5000000.000' },
  sumsInsured: { total: '5000000.000' },
  namedPerils: ['fire'],
  extensions: [],
};
/** All six factors are required by `RationaleFactorsDto`; a missing one is a 400 on the draft. */
const FACTORS = {
  coverage: 'Matches every requested peril plus the two extensions.',
  price: 'Lowest premium of the shortlist.',
  financialStrength: 'A- rated carrier, adequate for this exposure.',
  claimsService: 'Local adjuster panel, ten-day average settlement.',
  deductible: 'JOD 1,000, in line with the market for this class.',
  policyConditions: 'No unusual warranties; standard subrogation clause.',
};

async function buildOpportunity(
  ownerUserId: string,
  tag: string,
): Promise<{ opportunityId: string; rfqId: string; insurerId: string }> {
  const rand = Math.random().toString(36).slice(2, 8);
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `Discard E2E ${tag} ${rand}`,
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
  const insurer = await makeInsurer(`Discard E2E ${tag} ins ${rand}`);
  await prisma.rFQInsurer.create({
    data: { rfqId: rfq.id, insurerId: insurer.id, status: 'SENT' },
  });
  return {
    opportunityId: opportunity.id,
    rfqId: rfq.id,
    insurerId: insurer.id,
  };
}

/** A DRAFTED recommendation — pre-commitment, because it has not been sent to the client. */
async function draftRecommendation(
  app: INestApplication<App>,
  token: string,
  ownerUserId: string,
  tag: string,
): Promise<{ recommendationId: string; opportunityId: string }> {
  const { opportunityId, rfqId, insurerId } = await buildOpportunity(
    ownerUserId,
    tag,
  );
  const quote = await request(app.getHttpServer())
    .post('/quotations')
    .set(bearer(token))
    .send({
      rfqId,
      insurerId,
      premium: '90000.000',
      commissionRatePercent: '12',
    })
    .expect(201);
  const drafted = await request(app.getHttpServer())
    .post('/recommendations')
    .set(bearer(token))
    .send({
      opportunityId,
      recommendedQuotationId: (quote.body as QuotationChainBody).current.id,
      rationale: 'A long enough written summary to pass the length check.',
      rationaleFactors: FACTORS,
    })
    .expect(201);
  return {
    recommendationId: (drafted.body as { id: string }).id,
    opportunityId,
  };
}

/** A PLACEMENT_CONFIRMED policy — placed, not yet issued. */
async function placedPolicy(
  app: INestApplication<App>,
  token: string,
  ownerUserId: string,
  tag: string,
): Promise<{ policyId: string; opportunityId: string }> {
  const { recommendationId, opportunityId } = await draftRecommendation(
    app,
    token,
    ownerUserId,
    tag,
  );
  await request(app.getHttpServer())
    .post(`/recommendations/${recommendationId}/send`)
    .set(bearer(token))
    .expect(201);
  await request(app.getHttpServer())
    .post('/client-decisions')
    .set(bearer(token))
    .send({
      opportunityId,
      decision: 'ACCEPT',
      evidenceType: 'e-signature',
      evidenceRef: `env-${tag}-${RUN}`,
    })
    .expect(201);
  const placed = await request(app.getHttpServer())
    .post('/policies')
    .set(bearer(token))
    .send({
      opportunityId,
      inceptionDate: '2026-01-01',
      expiryDate: '2026-12-31',
    })
    .expect(201);
  const body = placed.body as PolicyBody;
  expect(body.status).toBe('PLACEMENT_CONFIRMED');
  return { policyId: body.id, opportunityId };
}

/** Place + issue + check + deliver + acknowledge: an ACTIVE policy an endorsement can be raised against. */
async function activePolicy(
  app: INestApplication<App>,
  placerToken: string,
  checkerToken: string,
  ownerUserId: string,
  tag: string,
): Promise<{ policyId: string }> {
  const { policyId } = await placedPolicy(app, placerToken, ownerUserId, tag);
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/issuance`)
    .set(bearer(placerToken))
    .send({
      policyNumber: `POL-DIS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      issuedPremium: '90000.000',
      schedule: ISSUED_SCHEDULE,
      documents: [],
    })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/checking`)
    .set(bearer(checkerToken))
    .send({ requestedCoverage: ISSUED_SCHEDULE })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/delivery`)
    .set(bearer(placerToken))
    .send({ method: 'courier', recipient: 'Acme Risk Dept' })
    .expect(201);
  const acked = await request(app.getHttpServer())
    .post(`/policies/${policyId}/delivery/acknowledge-receipt`)
    .set(bearer(placerToken))
    .send({})
    .expect(201);
  expect((acked.body as PolicyBody).status).toBe('ACTIVE');
  return { policyId };
}

/** A NOTIFIED claim on an ACTIVE policy — pre-commitment, because it is not registered with the insurer. */
async function notifiedClaim(
  app: INestApplication<App>,
  token: string,
  policyId: string,
): Promise<string> {
  const notified = await request(app.getHttpServer())
    .post('/claims')
    .set(bearer(token))
    .send({
      policyId,
      lossDate: '2026-06-01',
      causeOfLoss: 'Water ingress through the roof after a storm.',
      estimatedLoss: '18000.000',
    })
    .expect(201);
  const body = notified.body as DiscardableBody;
  expect(body.status).toBe('NOTIFIED');
  return body.id;
}

/** Every discard block is asserted through this, so no case can accidentally check less than another. */
function expectDiscarded(
  body: DiscardableBody,
  actorUserId: string,
  reason: string,
): void {
  expect(
    body.discard,
    'the record must come back carrying its discard',
  ).not.toBeNull();
  const discard = body.discard as DiscardBlock;
  expect(discard.byUserId).toBe(actorUserId);
  expect(discard.reason).toBe(reason);
  expect(new Date(discard.at).getTime()).toBeGreaterThan(0);
}

describe('Discard — a pre-commitment record raised in error (e2e)', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
    // db-test is cumulative; a leftover role moves every count of the catalogue.
    if (createdRoleIds.length > 0) {
      await prisma.userRoleAssignment.deleteMany({
        where: { roleId: { in: createdRoleIds } },
      });
      await prisma.rolePermission.deleteMany({
        where: { roleId: { in: createdRoleIds } },
      });
      await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    }
  });

  // --- 1. Created, discarded, read back -----------------------------------------------------------------

  it('all four: the record stays, marked discarded, carrying actor, timestamp and reason', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'dis-all-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'dis-all-chk', 'POLICY_CHECKING_OFFICER');

    // RECOMMENDATION — drafted, never sent.
    const { recommendationId } = await draftRecommendation(
      app,
      plc.accessToken,
      plc.userId,
      'rec',
    );
    await request(app.getHttpServer())
      .post(`/recommendations/${recommendationId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(201);
    const recRead = await request(app.getHttpServer())
      .get(`/recommendations/${recommendationId}`)
      .set(bearer(plc.accessToken))
      .expect(200);
    expectDiscarded(recRead.body as DiscardableBody, plc.userId, REASON);

    // POLICY — placed, never issued.
    const { policyId } = await placedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'pol',
    );
    await request(app.getHttpServer())
      .post(`/policies/${policyId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(201);
    const polRead = await request(app.getHttpServer())
      .get(`/policies/${policyId}`)
      .set(bearer(plc.accessToken))
      .expect(200);
    expectDiscarded(polRead.body as DiscardableBody, plc.userId, REASON);
    // Still PLACEMENT_CONFIRMED: a discard is a state ALONGSIDE the status, not a status of its own. If it
    // rewrote the status, every status-keyed report would silently change shape.
    expect((polRead.body as PolicyBody).status).toBe('PLACEMENT_CONFIRMED');

    // CLAIM — notified, never registered. Needs a real ACTIVE policy to sit on.
    const active = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'clm',
    );
    const claimId = await notifiedClaim(app, plc.accessToken, active.policyId);
    await request(app.getHttpServer())
      .post(`/claims/${claimId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(201);
    const clmRead = await request(app.getHttpServer())
      .get(`/claims/${claimId}`)
      .set(bearer(plc.accessToken))
      .expect(200);
    expectDiscarded(clmRead.body as DiscardableBody, plc.userId, REASON);

    // ENDORSEMENT — raised, never applied.
    const raised = await request(app.getHttpServer())
      .post(`/policies/${active.policyId}/endorsements`)
      .set(bearer(plc.accessToken))
      .send({
        type: 'POSITIVE',
        changeType: 'sum_insured_increase',
        premiumAmount: '2500.000',
        effectiveFrom: '2026-07-01',
        targetCoverage: {
          limits: { buildings: '6000000.000' },
          sumsInsured: { total: '6000000.000' },
          namedPerils: ['fire'],
          extensions: [],
        },
      })
      .expect(201);
    const endorsementId = (raised.body as DiscardableBody).id;
    await request(app.getHttpServer())
      .post(`/endorsements/${endorsementId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(201);
    const endRead = await request(app.getHttpServer())
      .get(`/endorsements/${endorsementId}`)
      .set(bearer(plc.accessToken))
      .expect(200);
    expectDiscarded(endRead.body as DiscardableBody, plc.userId, REASON);
  }, 300_000);

  it('the reason is mandatory and has to say something — and a discard cannot be repeated', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'dis-reason-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const { recommendationId } = await draftRecommendation(
      app,
      plc.accessToken,
      plc.userId,
      'reason',
    );

    // No reason at all.
    await request(app.getHttpServer())
      .post(`/recommendations/${recommendationId}/discard`)
      .set(bearer(plc.accessToken))
      .send({})
      .expect(400);
    // A reason too short to tell anybody anything. The floor exists because who and when are recoverable
    // from an audit row and "why this should never have existed" is not.
    await request(app.getHttpServer())
      .post(`/recommendations/${recommendationId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: 'oops' })
      .expect(400);
    // Whitespace is not a reason — the DTO trims nothing, so this is the service's floor and the CHECK
    // constraint's, both of which measure the TRIMMED length.
    await request(app.getHttpServer())
      .post(`/recommendations/${recommendationId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: '              ' })
      .expect(422);

    // Still live after three refusals — a refused discard must not half-write.
    const stillLive = await request(app.getHttpServer())
      .get(`/recommendations/${recommendationId}`)
      .set(bearer(plc.accessToken))
      .expect(200);
    expect((stillLive.body as DiscardableBody).discard).toBeNull();

    await request(app.getHttpServer())
      .post(`/recommendations/${recommendationId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(201);

    // Terminal: a second discard is refused, and the first person's reason is the one that stands.
    const second = await request(app.getHttpServer())
      .post(`/recommendations/${recommendationId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: 'A different reason from a different person entirely.' })
      .expect(409);
    expect(JSON.stringify(second.body)).toContain('already discarded');
    const afterSecond = await request(app.getHttpServer())
      .get(`/recommendations/${recommendationId}`)
      .set(bearer(plc.accessToken))
      .expect(200);
    expect((afterSecond.body as DiscardableBody).discard?.reason).toBe(REASON);
  }, 300_000);

  it('a withdrawn record STAYS in its own register — the list still returns it, marked', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'dis-list-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
      'CLAIMS_OFFICER',
    );
    const chk = await makeUser(app, 'dis-list-chk', 'POLICY_CHECKING_OFFICER');
    const active = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'list',
    );
    const claimId = await notifiedClaim(app, plc.accessToken, active.policyId);
    await request(app.getHttpServer())
      .post(`/claims/${claimId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(201);

    // THE RULE THIS ASSERTS: a discarded record stays in its own register and leaves every DERIVED view.
    // The register is where somebody looking for the mistake goes — the same argument that keeps a
    // deactivated insurer in the insurer list, where hiding it would read as deletion. Scoped by this
    // claim's own policy, never a whole-table read: db-test is cumulative.
    const listed = await request(app.getHttpServer())
      .get(`/claims?policyId=${active.policyId}`)
      .set(bearer(plc.accessToken))
      .expect(200);
    const rows = listed.body as
      { items?: DiscardableBody[] } | DiscardableBody[];
    const items = Array.isArray(rows) ? rows : (rows.items ?? []);
    const mine = items.find((c) => c.id === claimId);
    expect(
      mine,
      'the withdrawn claim must still be in its own list',
    ).toBeDefined();
    expectDiscarded(mine as DiscardableBody, plc.userId, REASON);

    // And it has LEFT the derived view: the customer's 360° timeline, which exists to tell whoever is on the
    // phone what this client actually has.
    const customerId = (
      await prisma.claim.findUniqueOrThrow({
        where: { id: claimId },
        select: { customerId: true },
      })
    ).customerId;
    const timeline = await request(app.getHttpServer())
      .get(`/customers/${customerId}/360-view`)
      .set(bearer(plc.accessToken))
      // 200 asserted, not branched on. This actor holds `customer.360-view.read` through Sales; if that ever
      // stops being true, the absence assertion below would be satisfied by a 403 body and prove nothing —
      // the § 1.51(d) shape. (Written once without the bearer header, which produced a 401 and is a reminder
      // that "the assertion failed" and "the request was never authorised" look identical from the outside.)
      .expect(200);
    const body = JSON.stringify(timeline.body);
    // Something POSITIVE from the same read first, so "the claim is absent" cannot be satisfied by an empty
    // or error payload.
    expect(body).toContain(active.policyId);
    expect(body).not.toContain(claimId);
  }, 300_000);

  // --- 2. A discarded record cannot advance -------------------------------------------------------------

  it('every forward move refuses a discarded record, and the refusal names the discard', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'dis-adv-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
      // `claim.register` is the Claims Officer's, not the placer's — and one actor wearing both keeps the
      // customer's owner and the registrar the same person, so a 404 about visibility cannot be mistaken for
      // the refusal these cases are about.
      'CLAIMS_OFFICER',
    );
    const chk = await makeUser(app, 'dis-adv-chk', 'POLICY_CHECKING_OFFICER');

    // POLICY: issuance. Note the shape — a discarded policy is STILL PLACEMENT_CONFIRMED, so it sails past
    // `recordIssuance`'s own status check and is stopped by the engine's guard. That is exactly why the
    // guard lives in the engine and not in four services.
    const { policyId } = await placedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'adv-pol',
    );
    await request(app.getHttpServer())
      .post(`/policies/${policyId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(201);
    const issuance = await request(app.getHttpServer())
      .post(`/policies/${policyId}/issuance`)
      .set(bearer(plc.accessToken))
      .send({
        policyNumber: `POL-ADV-${Date.now()}`,
        issuedPremium: '90000.000',
        schedule: ISSUED_SCHEDULE,
        documents: [],
      })
      .expect(422);
    expect(JSON.stringify(issuance.body)).toContain('discarded');
    expect(JSON.stringify(issuance.body)).toContain(policyId);
    // And it really did not advance.
    const stillPlaced = await request(app.getHttpServer())
      .get(`/policies/${policyId}`)
      .set(bearer(plc.accessToken))
      .expect(200);
    expect((stillPlaced.body as PolicyBody).status).toBe('PLACEMENT_CONFIRMED');
    expect((stillPlaced.body as PolicyBody).issuedPremium).toBeNull();

    // CLAIM: registration.
    const active = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'adv-clm',
    );
    const claimId = await notifiedClaim(app, plc.accessToken, active.policyId);
    await request(app.getHttpServer())
      .post(`/claims/${claimId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(201);
    const registration = await request(app.getHttpServer())
      .post(`/claims/${claimId}/registration`)
      .set(bearer(plc.accessToken))
      .send({
        insurerClaimReference: `INS-${Date.now()}`,
        adjuster: { name: 'A. Adjuster' },
      })
      .expect(422);
    expect(JSON.stringify(registration.body)).toContain('discarded');
    expect(JSON.stringify(registration.body)).toContain(claimId);

    // ENDORSEMENT: advance.
    const raised = await request(app.getHttpServer())
      .post(`/policies/${active.policyId}/endorsements`)
      .set(bearer(plc.accessToken))
      .send({
        type: 'POSITIVE',
        changeType: 'sum_insured_increase',
        premiumAmount: '1000.000',
        effectiveFrom: '2026-07-01',
        targetCoverage: {
          limits: { buildings: '5500000.000' },
          sumsInsured: { total: '5500000.000' },
          namedPerils: ['fire'],
          extensions: [],
        },
      })
      .expect(201);
    const endorsementId = (raised.body as DiscardableBody).id;
    await request(app.getHttpServer())
      .post(`/endorsements/${endorsementId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(201);
    const advanced = await request(app.getHttpServer())
      .post(`/endorsements/${endorsementId}/advance`)
      .set(bearer(plc.accessToken))
      .send({})
      .expect(422);
    expect(JSON.stringify(advanced.body)).toContain('discarded');
    expect(JSON.stringify(advanced.body)).toContain(endorsementId);

    // RECOMMENDATION: send. Not a workflow entity — no status column, and it drives the Opportunity's
    // transitions rather than its own — so this one is guarded in its own service, and this assertion is
    // what proves that second guard exists rather than being assumed to come from the engine.
    const { recommendationId } = await draftRecommendation(
      app,
      plc.accessToken,
      plc.userId,
      'adv-rec',
    );
    await request(app.getHttpServer())
      .post(`/recommendations/${recommendationId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(201);
    const sent = await request(app.getHttpServer())
      .post(`/recommendations/${recommendationId}/send`)
      .set(bearer(plc.accessToken))
      .expect(422);
    expect(JSON.stringify(sent.body)).toContain('discarded');
    expect(JSON.stringify(sent.body)).toContain(recommendationId);
  }, 300_000);

  // --- 3. A committed record cannot be discarded --------------------------------------------------------

  it('a committed record refuses the discard and names its own point of no return', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'dis-com-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
      // `claim.register` is the Claims Officer's, not the placer's — and one actor wearing both keeps the
      // customer's owner and the registrar the same person, so a 404 about visibility cannot be mistaken for
      // the refusal these cases are about.
      'CLAIMS_OFFICER',
    );
    const chk = await makeUser(app, 'dis-com-chk', 'POLICY_CHECKING_OFFICER');

    // ISSUED POLICY (and the recommendation behind it, which the chain sent to the client).
    const { policyId, opportunityId } = await placedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'com',
    );
    // The chain SENT this recommendation to the client on the way to placing the policy, so it is committed.
    const recommendation = await prisma.recommendation.findFirstOrThrow({
      where: { opportunityId },
      select: { id: true },
    });
    const sentRec = await request(app.getHttpServer())
      .post(`/recommendations/${recommendation.id}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(422);
    expect(JSON.stringify(sentRec.body)).toContain('sent to the client');

    await request(app.getHttpServer())
      .post(`/policies/${policyId}/issuance`)
      .set(bearer(plc.accessToken))
      .send({
        policyNumber: `POL-COM-${Date.now()}`,
        issuedPremium: '90000.000',
        schedule: ISSUED_SCHEDULE,
        documents: [],
      })
      .expect(201);
    const issued = await request(app.getHttpServer())
      .post(`/policies/${policyId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(422);
    expect(JSON.stringify(issued.body)).toContain('before it is issued');

    // REGISTERED CLAIM.
    await request(app.getHttpServer())
      .post(`/policies/${policyId}/checking`)
      .set(bearer(chk.accessToken))
      .send({ requestedCoverage: ISSUED_SCHEDULE })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/policies/${policyId}/delivery`)
      .set(bearer(plc.accessToken))
      .send({ method: 'courier', recipient: 'Acme Risk Dept' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/policies/${policyId}/delivery/acknowledge-receipt`)
      .set(bearer(plc.accessToken))
      .send({})
      .expect(201);
    const claimId = await notifiedClaim(app, plc.accessToken, policyId);
    await request(app.getHttpServer())
      .post(`/claims/${claimId}/registration`)
      .set(bearer(plc.accessToken))
      .send({
        insurerClaimReference: `INS-COM-${Date.now()}`,
        adjuster: { name: 'A. Adjuster' },
      })
      .expect(201);
    const registered = await request(app.getHttpServer())
      .post(`/claims/${claimId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(422);
    expect(JSON.stringify(registered.body)).toContain(
      'before it is registered with the insurer',
    );

    // APPLIED ENDORSEMENT — the whole lifecycle, because "applied" is the commitment this feature is about.
    const raised = await request(app.getHttpServer())
      .post(`/policies/${policyId}/endorsements`)
      .set(bearer(plc.accessToken))
      .send({
        type: 'POSITIVE',
        changeType: 'sum_insured_increase',
        premiumAmount: '2000.000',
        effectiveFrom: '2026-07-01',
        targetCoverage: {
          limits: { buildings: '7000000.000' },
          sumsInsured: { total: '7000000.000' },
          namedPerils: ['fire'],
          extensions: [],
        },
      })
      .expect(201);
    const endorsementId = (raised.body as DiscardableBody).id;
    await request(app.getHttpServer())
      .post(`/endorsements/${endorsementId}/advance`)
      .set(bearer(plc.accessToken))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/endorsements/${endorsementId}/advance`)
      .set(bearer(plc.accessToken))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/endorsements/${endorsementId}/calculate-adjustment`)
      .set(bearer(plc.accessToken))
      .send({ premiumAmount: '2000.000' })
      .expect(201);
    const applied = await request(app.getHttpServer())
      .post(`/endorsements/${endorsementId}/apply`)
      .set(bearer(plc.accessToken))
      .expect(201);
    expect((applied.body as DiscardableBody).status).toBe('APPLIED');
    const appliedDiscard = await request(app.getHttpServer())
      .post(`/endorsements/${endorsementId}/discard`)
      .set(bearer(plc.accessToken))
      .send({ reason: REASON })
      .expect(422);
    expect(JSON.stringify(appliedDiscard.body)).toContain(
      'before it is applied',
    );
  }, 600_000);

  // --- 4. The endorsement trap is gone ------------------------------------------------------------------

  it('discarding a wrongly raised endorsement leaves the policy, its premium, its schedule and its commission untouched', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'dis-trap-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'dis-trap-chk', 'POLICY_CHECKING_OFFICER');
    const { policyId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'trap',
    );

    // Read the policy from the DATABASE before the mistake — the comparison has to be against stored rows,
    // not against a response shape that could itself be wrong.
    const before = await prisma.policy.findUniqueOrThrow({
      where: { id: policyId },
      select: {
        status: true,
        issuedPremium: true,
        schedules: { select: { id: true, sumsInsured: true } },
      },
    });

    const raised = await request(app.getHttpServer())
      .post(`/policies/${policyId}/endorsements`)
      .set(bearer(plc.accessToken))
      .send({
        type: 'POSITIVE',
        changeType: 'sum_insured_increase',
        premiumAmount: '45000.000',
        effectiveFrom: '2026-07-01',
        targetCoverage: {
          limits: { buildings: '99000000.000' },
          sumsInsured: { total: '99000000.000' },
          namedPerils: ['fire'],
          extensions: [],
        },
      })
      .expect(201);
    const endorsementId = (raised.body as DiscardableBody).id;

    await request(app.getHttpServer())
      .post(`/endorsements/${endorsementId}/discard`)
      .set(bearer(plc.accessToken))
      .send({
        reason: 'Raised against the wrong policy — belongs to another client.',
      })
      .expect(201);

    const after = await prisma.policy.findUniqueOrThrow({
      where: { id: policyId },
      select: {
        status: true,
        issuedPremium: true,
        schedules: { select: { id: true, sumsInsured: true } },
      },
    });
    expect(after.status).toBe(before.status);
    expect(after.issuedPremium?.toString()).toBe(
      before.issuedPremium?.toString(),
    );
    // No NEW schedule version: applying an endorsement is what opens one, and this one was never applied.
    expect(after.schedules.map((s) => s.id).sort()).toEqual(
      before.schedules.map((s) => s.id).sort(),
    );
    expect(JSON.stringify(after.schedules.map((s) => s.sumsInsured))).toBe(
      JSON.stringify(before.schedules.map((s) => s.sumsInsured)),
    );

    // And the money the endorsement lifecycle would have moved was never moved.
    expect(
      await prisma.refund.count({ where: { endorsementId } }),
      'a discarded endorsement raises no refund',
    ).toBe(0);
    expect(
      await prisma.commissionReversal.count({ where: { endorsementId } }),
      'a discarded endorsement reverses no commission',
    ).toBe(0);

    // The old exit from this mistake was to APPLY it. That door is shut: the discarded endorsement cannot
    // advance, so there is no path from here that touches the policy at all.
    await request(app.getHttpServer())
      .post(`/endorsements/${endorsementId}/advance`)
      .set(bearer(plc.accessToken))
      .send({})
      .expect(422);
  }, 600_000);

  it('a discarded cancellation frees the policy — a second cancellation can be raised', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'dis-canc-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
      'COMPLIANCE_OFFICER',
    );
    const chk = await makeUser(app, 'dis-canc-chk', 'POLICY_CHECKING_OFFICER');
    const { policyId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'canc',
    );

    const first = await request(app.getHttpServer())
      .post(`/policies/${policyId}/cancellation`)
      .set(bearer(plc.accessToken))
      .send({
        reason:
          'Client asked to cancel — later turned out to be the wrong policy.',
        basis: 'pro_rata',
        effectiveFrom: '2026-07-01',
      })
      .expect(201);
    const firstId = (first.body as DiscardableBody).id;

    // Before the discard, a second cancellation is refused — the partial UNIQUE index, which is the point.
    await request(app.getHttpServer())
      .post(`/policies/${policyId}/cancellation`)
      .set(bearer(plc.accessToken))
      .send({
        reason: 'The real cancellation this client actually asked for.',
        basis: 'pro_rata',
        effectiveFrom: '2026-07-01',
      })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/endorsements/${firstId}/discard`)
      .set(bearer(plc.accessToken))
      .send({
        reason: 'Cancellation raised against the wrong policy entirely.',
      })
      .expect(201);

    // THE REAL PROOF. Without `discardedAt IS NULL` in the index predicate this 201 is a 409 forever: a
    // discarded endorsement can never reach CLIENT_NOTIFIED, so it would occupy the policy's one live
    // cancellation slot permanently and the only exit would be to apply the cancellation nobody wanted.
    const second = await request(app.getHttpServer())
      .post(`/policies/${policyId}/cancellation`)
      .set(bearer(plc.accessToken))
      .send({
        reason: 'The real cancellation this client actually asked for.',
        basis: 'pro_rata',
        effectiveFrom: '2026-07-01',
      })
      .expect(201);
    expect((second.body as DiscardableBody).id).not.toBe(firstId);
  }, 600_000);

  // --- 5. Discard is its own permission -----------------------------------------------------------------

  it('discard is its own code: creating a record does not confer withdrawing one', async () => {
    const app = await boot();
    const owner = await makeUser(
      app,
      'dis-perm-owner',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const { recommendationId } = await draftRecommendation(
      app,
      owner.accessToken,
      owner.userId,
      'perm',
    );

    // Everything a drafter holds, EXCEPT the discard. `recommendation.all-owners.read` is what makes the
    // record visible to this actor at all — the drafter above owns the customer, this actor does not — and
    // without it the refusal below would be a 404 about visibility rather than the 403 about the permission,
    // so the test would pass for the wrong reason. That code, not a `customer.*` one: recommendation
    // visibility resolves through its own family, and the two sets differ by exactly Compliance.
    const drafter = await actorHolding(app, 'discard-drafter', [
      'recommendation.draft',
      'recommendation.read',
      'recommendation.send',
      'recommendation.all-owners.read',
    ]);
    await request(app.getHttpServer())
      .get(`/recommendations/${recommendationId}`)
      .set(bearer(drafter.accessToken))
      .expect(200); // The record IS reachable — so the 403 below is about the discard code and nothing else.
    await request(app.getHttpServer())
      .post(`/recommendations/${recommendationId}/discard`)
      .set(bearer(drafter.accessToken))
      .send({ reason: REASON })
      .expect(403);

    // The same actor shape plus the one code. Holding the discard alone is enough: it does not ride along on
    // draft, and draft does not ride along on it.
    const discarder = await actorHolding(app, 'discard-only', [
      'recommendation.discard',
      'recommendation.read',
      'recommendation.all-owners.read',
    ]);
    await request(app.getHttpServer())
      .post('/recommendations')
      .set(bearer(discarder.accessToken))
      .send({
        opportunityId: '00000000-0000-4000-8000-000000000000',
        recommendedQuotationId: '00000000-0000-4000-8000-000000000000',
        rationale: 'A long enough written summary to pass the length check.',
        rationaleFactors: FACTORS,
      })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/recommendations/${recommendationId}/discard`)
      .set(bearer(discarder.accessToken))
      .send({ reason: REASON })
      .expect(201);
    const read = await request(app.getHttpServer())
      .get(`/recommendations/${recommendationId}`)
      .set(bearer(discarder.accessToken))
      .expect(200);
    expectDiscarded(read.body as DiscardableBody, discarder.userId, REASON);
  }, 300_000);
});
