import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma, rawPrisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';
import { makeLocalInsurer } from './insurer-fixture';

/**
 * Insurer management, commit 5 — `Insurer.isActive` starts meaning something.
 *
 * ## The finding this closes
 *
 * The column has existed since the model was created and was read by NOTHING:
 * zero filters, zero branches, API-wide. `RfqRepository.findSelectableInsurers()`
 * returned every insurer the office had ever dealt with, so a company it had
 * deliberately stopped dealing with was still offered on the new-RFQ screen.
 *
 * So shipping a deactivate button against that code would have produced a control
 * that writes an audit row and changes nothing — the same shape as the fail-open
 * MFA lists Phase 2 removed. Deactivation is ENFORCED here, one commit before the
 * screen that exposes it.
 *
 * ## What stops, and what must never stop
 *
 * NEW USE stops: the shortlist picker does not offer them, a new RFQ cannot
 * shortlist them, an existing RFQ cannot have them added, and a policy cannot be
 * placed with them (that last one is in `policy.e2e-spec.ts`, where the placement
 * fixture chain already lives).
 *
 * EXISTING OBLIGATIONS never stop: in-force policies stay in force, open claims
 * proceed, invoices and remittances settle, and history stays in every report. An
 * insurer leaving the market is the ordinary case — a system that refused to
 * deactivate them while a single policy was live would force the office to keep
 * placing business with a company it cannot deal with.
 *
 * ## One deliberate exception: capturing a quotation
 *
 * `quotation.service.ts` documents that recording a premium an insurer actually
 * sent is a FACTUAL event, and refuses nothing for a late quote landing after the
 * business went elsewhere. A quote is a record of what was offered; a policy is a
 * commitment. Only the second is blocked, and the test at the bottom pins that
 * distinction so it is a decision rather than an oversight.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const tag = Math.random().toString(36).slice(2, 8);

/** Fixed prefix, swept at BOTH ends — the third time this session that a
 *  test-body cleanup proved insufficient. An insurer left behind with
 *  `isActive: false` would change what a later spec's picker returns, and one
 *  left behind at all keeps `db-test` from ever being rolled back past the
 *  migration that made the master link nullable. */
const FIXTURE_PREFIX = 'Deactivation Fixture';

let app: INestApplication<App> | null = null;

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function removeFixtureInsurers(): Promise<void> {
  const insurers = await prisma.insurer.findMany({
    where: { legalName: { startsWith: FIXTURE_PREFIX } },
    select: { id: true },
  });
  if (insurers.length === 0) return;
  const ids = insurers.map((i) => i.id);
  // CHILDREN FIRST, IN FK ORDER. Every FK into `Insurer` is RESTRICT, so the
  // parent delete fails loudly rather than cascading — which is correct for
  // production data and means a fixture sweep has to know the order.
  //
  // `Quotation` is the one that caught this, twice. The last test captures a quote
  // from a deactivated insurer (deliberately — see its comment), so the first
  // version of this sweep failed on `Quotation_insurerId_fkey` with all six tests
  // green: a file can be red with every test passing. The second version tried to
  // delete the quotations and hit a DB TRIGGER — "Quotation rows are never deleted
  // (backlog Part C #15): a negotiation round is a new version, not a replacement".
  //
  // So the trigger is bypassed for this file's own fixture rows only, on the OWNER
  // connection, exactly as `last-administrator-lock.e2e-spec.ts` does for the
  // immutable audit trail. The trigger protects a real record of what an insurer
  // offered; these are fixtures, and leaving them would pin a fixture insurer in a
  // cumulative database forever.
  await rawPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.$executeRaw`DELETE FROM "Quotation" WHERE "insurerId" = ANY(${ids})`;
  });
  await prisma.rFQInsurer.deleteMany({ where: { insurerId: { in: ids } } });
  await prisma.insurerProduct.deleteMany({ where: { insurerId: { in: ids } } });
  // The obligation chain the impact-count test builds, deepest first. `Policy` is the
  // one that pins the insurer (RESTRICT again), and an invoice and a renewal case pin
  // the policy — so all three have to go before the insurer can, and in this order.
  //
  // This is the THIRD time this sweep has grown to follow a new FK, and each time the
  // symptom was identical: every test green, the file red. Adding a fixture row with a
  // RESTRICT parent means extending this function in the same commit.
  const policies = await prisma.policy.findMany({
    where: { insurerId: { in: ids } },
    select: { id: true },
  });
  const policyIds = policies.map((p) => p.id);
  if (policyIds.length > 0) {
    await prisma.invoice.deleteMany({ where: { policyId: { in: policyIds } } });
    await prisma.renewalCase.deleteMany({
      where: { policyId: { in: policyIds } },
    });
    await prisma.policy.deleteMany({ where: { id: { in: policyIds } } });
  }
  await prisma.insurer.deleteMany({ where: { id: { in: ids } } });
}

async function makeUser(
  label: string,
  ...roleNames: string[]
): Promise<{ accessToken: string; userId: string }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Deactivation ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(app!.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as { accessToken: string; user: { id: string } };

  const enroll = await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(body.accessToken))
    .expect(201);
  const enrollBody = enroll.body as {
    credentialId: string;
    otpAuthUri: string;
  };
  const secret = /[?&]secret=([^&]+)/.exec(enrollBody.otpAuthUri)![1];
  await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);

  for (const name of roleNames) {
    const role = await ensureRole(name);
    const active = await prisma.userRoleAssignment.findFirst({
      where: { userId: body.user.id, roleId: role.id, revokedAt: null },
    });
    if (!active) {
      await prisma.userRoleAssignment.create({
        data: { userId: body.user.id, roleId: role.id },
      });
    }
  }
  return { accessToken: body.accessToken, userId: body.user.id };
}

/** An Opportunity taken to market, so a shortlist can be probed. Direct writes:
 *  the point here is the insurer guard, not the funnel that leads to it. */
async function marketReadyOpportunity(ownerUserId: string): Promise<string> {
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `${FIXTURE_PREFIX} Customer ${tag}-${Math.random().toString(36).slice(2, 6)}`,
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
      status: 'NEEDS_CONFIRMED',
    },
  });
  await prisma.insuranceProgramLine.create({
    data: {
      insuranceProgramId: program.id,
      insuranceLine: 'Property All Risks',
    },
  });
  return opportunity.id;
}

/**
 * One of each obligation the impact counts report, as fixture rows.
 *
 * Direct inserts rather than the real workflow, deliberately: reaching an ACTIVE policy
 * through the API means placement, issuance, checking, delivery and an invoice cycle,
 * and what is under test here is whether four COUNT queries read the right rows — not
 * the lifecycle that produces them. The RFQ submission is the exception and goes through
 * the real endpoint, because that one is cheap.
 */
async function outstandingObligations(
  insurerId: string,
  ownerUserId: string,
): Promise<{ policyId: string }> {
  const suffix = Math.random().toString(36).slice(2, 6);
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `${FIXTURE_PREFIX} Obligor ${tag}-${suffix}`,
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
      status: 'NEEDS_CONFIRMED',
    },
  });
  // ACTIVE, because `IN_FORCE_POLICY_STATUSES` is `ACTIVE` alone — the shared constant
  // the count reuses rather than coining a second definition of "in force".
  const policy = await prisma.policy.create({
    data: {
      opportunityId: opportunity.id,
      customerId: customer.id,
      insurerId,
      insuranceLine: 'Property All Risks',
      requestedPremium: '12000.000',
      status: 'ACTIVE',
    },
  });
  // Open: anything that is not RENEWED, LAPSED or CANCELLED.
  await prisma.renewalCase.create({
    data: { policyId: policy.id, status: 'IN_PROGRESS' },
  });
  // Unsettled: not yet REMITTED, the hop that discharges the obligation to the insurer.
  await prisma.invoice.create({
    data: {
      customerId: customer.id,
      policyId: policy.id,
      premiumAmount: '12000.000',
      totalAmount: '12000.000',
      dueDate: new Date('2026-12-31T00:00:00.000Z'),
      status: 'INVOICED',
    },
  });
  return { policyId: policy.id };
}

beforeAll(async () => {
  await removeFixtureInsurers();
  app = await createTestApp();
}, 240_000);

afterAll(async () => {
  await removeFixtureInsurers();
  await app?.close();
  app = null;
});

describe('the shortlist picker offers only active insurers', () => {
  it('excludes a deactivated insurer and keeps an active one', async () => {
    // The endpoint that had no test at all before this feature, now asserting the
    // filter that had no reader.
    const active = await makeLocalInsurer(`${FIXTURE_PREFIX} Active ${tag}`);
    const retired = await makeLocalInsurer(`${FIXTURE_PREFIX} Retired ${tag}`, {
      isActive: false,
    });
    const officer = await makeUser(
      `deact-picker-${tag}`,
      'PLACEMENT_TECHNICAL_OFFICER',
    );

    const res = await request(app!.getHttpServer())
      .get('/rfqs/selectable-insurers')
      .set(bearer(officer.accessToken))
      .expect(200);
    const names = (res.body as { name: string }[]).map((i) => i.name);
    expect(names).toContain(active.name);
    expect(
      names,
      'a deactivated insurer must not be offered for new business',
    ).not.toContain(retired.name);
  }, 300_000);
});

describe('a new RFQ cannot shortlist a deactivated insurer', () => {
  it('refuses it, and says DEACTIVATED rather than "does not exist"', async () => {
    // The two refusals are deliberately distinct. An unknown id is a client bug; a
    // deactivated insurer is a decision the office made and can undo. Reporting
    // "does not exist" for a company sitting in the office's own list would send
    // someone hunting a bug that is not there.
    const retired = await makeLocalInsurer(
      `${FIXTURE_PREFIX} RFQ Retired ${tag}`,
      { isActive: false },
    );
    const officer = await makeUser(
      `deact-rfq-${tag}`,
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const opportunityId = await marketReadyOpportunity(officer.userId);

    const refused = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Property All Risks',
        insurerIds: [retired.id],
      })
      .expect(422);
    const message = (refused.body as { message: string }).message;
    expect(message).toContain('deactivated insurer');
    expect(message).toContain(retired.id);
    expect(
      message,
      'a deactivated insurer is not a missing one — the messages must not be interchangeable',
    ).not.toContain('do not exist');
  }, 300_000);

  it('still reports an UNKNOWN id as not existing', async () => {
    // The other half of the split. If this collapsed into the deactivation message,
    // a genuine client bug would read as an office decision.
    const officer = await makeUser(
      `deact-unknown-${tag}`,
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const opportunityId = await marketReadyOpportunity(officer.userId);

    const refused = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Property All Risks',
        insurerIds: ['00000000-0000-4000-8000-000000000000'],
      })
      .expect(422);
    const message = (refused.body as { message: string }).message;
    expect(message).toContain('do not exist');
    expect(message).not.toContain('deactivated');
  }, 300_000);

  it('refuses ADDING a deactivated insurer to an RFQ that already exists', async () => {
    // The same guard on the other call site. An RFQ is out in the market; widening
    // its shortlist to a company the office has stopped dealing with is new business
    // on an old record.
    const active = await makeLocalInsurer(
      `${FIXTURE_PREFIX} Add Active ${tag}`,
    );
    const retired = await makeLocalInsurer(
      `${FIXTURE_PREFIX} Add Retired ${tag}`,
      { isActive: false },
    );
    const officer = await makeUser(
      `deact-add-${tag}`,
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const opportunityId = await marketReadyOpportunity(officer.userId);

    const created = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Property All Risks',
        insurerIds: [active.id],
      })
      .expect(201);
    const rfqId = (created.body as { id: string }).id;

    const refused = await request(app!.getHttpServer())
      .post(`/rfqs/${rfqId}/insurers`)
      .set(bearer(officer.accessToken))
      .send({ insurerIds: [retired.id] })
      .expect(422);
    expect((refused.body as { message: string }).message).toContain(
      'deactivated insurer',
    );
  }, 300_000);

  it('lets an insurer be shortlisted again once it is reactivated', async () => {
    // Deactivation is reversible, and nothing about the refusal may be sticky —
    // the same rule Phase 3 applied to retiring a role, where reactivation is never
    // refused because an office must be able to undo.
    const insurer = await makeLocalInsurer(
      `${FIXTURE_PREFIX} Reactivated ${tag}`,
      { isActive: false },
    );
    const officer = await makeUser(
      `deact-reactivate-${tag}`,
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const opportunityId = await marketReadyOpportunity(officer.userId);

    await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Property All Risks',
        insurerIds: [insurer.id],
      })
      .expect(422);

    await prisma.insurer.update({
      where: { id: insurer.id },
      data: { isActive: true },
    });

    await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Property All Risks',
        insurerIds: [insurer.id],
      })
      .expect(201);
  }, 300_000);
});

describe('capturing a quotation is NOT blocked — and that is deliberate', () => {
  it('records a quote from an insurer deactivated after it quoted', async () => {
    // The one place the plan's "new use stops" rule is deliberately not applied.
    //
    // `quotation.service.ts` documents that recording a premium an insurer actually
    // sent is a FACTUAL event: it refuses nothing for a late quote landing after the
    // business was placed elsewhere, or on a re-marketed Opportunity. A quote is a
    // record of what was OFFERED; a policy is a COMMITMENT. Blocking the record
    // would lose the audit trail of what the market said and leave the comparison
    // matrix incomplete, while changing nothing about the office's exposure —
    // because placement is blocked, which is where money and obligation attach.
    //
    // Pinned as a test so the asymmetry is a decision someone can disagree with,
    // rather than a gap nobody noticed.
    const insurer = await makeLocalInsurer(`${FIXTURE_PREFIX} Quoted ${tag}`);
    const officer = await makeUser(
      `deact-quote-${tag}`,
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const opportunityId = await marketReadyOpportunity(officer.userId);

    const created = await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(officer.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Property All Risks',
        insurerIds: [insurer.id],
      })
      .expect(201);
    const rfqId = (created.body as { id: string }).id;

    // Deactivated AFTER the RFQ went out — the quote is already in flight.
    await prisma.insurer.update({
      where: { id: insurer.id },
      data: { isActive: false },
    });

    await request(app!.getHttpServer())
      .post('/quotations')
      .set(bearer(officer.accessToken))
      .send({
        rfqId,
        insurerId: insurer.id,
        premium: '50000.000',
        currency: 'JOD',
        commissionRatePercent: '12.50',
      })
      .expect(201);
  }, 300_000);
});

describe('deactivating is an ACT, with a reason and a record of what was outstanding', () => {
  it('flips the flag, answers with live counts, and writes ONE audited UPDATE carrying them', async () => {
    const insurer = await makeLocalInsurer(`${FIXTURE_PREFIX} Acted On ${tag}`);
    const admin = await makeUser(
      `deact-admin-${tag}`,
      'OFFICE_ADMINISTRATOR',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // Something genuinely outstanding, through the real API: an RFQ sent to this
    // insurer and not yet answered. A test whose four counts are all zero would pass
    // against a service that returned four hard-coded zeros.
    const opportunityId = await marketReadyOpportunity(admin.userId);
    await request(app!.getHttpServer())
      .post('/rfqs')
      .set(bearer(admin.accessToken))
      .send({
        opportunityId,
        insuranceLine: 'Property All Risks',
        insurerIds: [insurer.id],
      })
      .expect(201);

    // And the three obligations that live further down the chain, as fixture rows:
    // what is under test is the COUNT, not the policy lifecycle that produces one.
    const { policyId } = await outstandingObligations(insurer.id, admin.userId);

    const response = await request(app!.getHttpServer())
      .post(`/insurers/${insurer.id}/deactivate`)
      .set(bearer(admin.accessToken))
      .send({
        reason: 'Relationship ended after the 2026 renewal season review.',
      })
      .expect(200);

    const body = response.body as {
      insurer: { id: string; isActive: boolean };
      impact: {
        policiesInForce: number;
        openRenewalCases: number;
        pendingRfqSubmissions: number;
        unsettledInvoices: number;
      };
    };
    expect(body.insurer.isActive).toBe(false);
    // Every one of the four moved off zero, so each is reading something real.
    expect(body.impact).toEqual({
      policiesInForce: 1,
      openRenewalCases: 1,
      pendingRfqSubmissions: 1,
      unsettledInvoices: 1,
    });

    // The audit row carries the reason and the same counts, flat, so a reader scanning
    // the trail sees what was outstanding without knowing this shape.
    const entries = await prisma.auditLogEntry.findMany({
      where: {
        entityType: 'Insurer',
        entityId: insurer.id,
        action: 'UPDATE',
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].beforeValue).toEqual({ isActive: true });
    expect(entries[0].afterValue).toMatchObject({
      isActive: false,
      reason: 'Relationship ended after the 2026 renewal season review.',
      policiesInForce: 1,
      openRenewalCases: 1,
      pendingRfqSubmissions: 1,
      unsettledInvoices: 1,
    });
    expect(entries[0].userId).toBe(admin.userId);

    // ALLOW AND RECORD: not one of those obligations changed. Refusing the
    // deactivation would not have settled an invoice, and stopping an in-force policy
    // would be a breach rather than a tidy-up.
    const policy = await prisma.policy.findUniqueOrThrow({
      where: { id: policyId },
      select: { status: true, insurerId: true },
    });
    expect(policy.status).toBe('ACTIVE');
    expect(policy.insurerId).toBe(insurer.id);
    expect(
      await prisma.invoice.count({
        where: { policyId, status: { not: 'REMITTED' } },
      }),
    ).toBe(1);
  }, 300_000);

  it('requires a reason, and refuses a token one', async () => {
    const insurer = await makeLocalInsurer(
      `${FIXTURE_PREFIX} Needs Reason ${tag}`,
    );
    const admin = await makeUser(`deact-reason-${tag}`, 'OFFICE_ADMINISTRATOR');

    await request(app!.getHttpServer())
      .post(`/insurers/${insurer.id}/deactivate`)
      .set(bearer(admin.accessToken))
      .send({})
      .expect(400);
    // Ten characters, the same floor the national-id reveal uses: long enough that "x"
    // is not a reason, short enough not to be theatre.
    await request(app!.getHttpServer())
      .post(`/insurers/${insurer.id}/deactivate`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'no' })
      .expect(400);

    // And the record is untouched by a refused attempt.
    const row = await prisma.insurer.findUniqueOrThrow({
      where: { id: insurer.id },
      select: { isActive: true },
    });
    expect(row.isActive).toBe(true);
  }, 300_000);

  it('is idempotent, and a second press does not write a second reason', async () => {
    const insurer = await makeLocalInsurer(`${FIXTURE_PREFIX} Twice ${tag}`);
    const admin = await makeUser(`deact-twice-${tag}`, 'OFFICE_ADMINISTRATOR');

    for (const reason of [
      'First decision, recorded with its own wording.',
      'Second press of the same button, minutes later.',
    ]) {
      await request(app!.getHttpServer())
        .post(`/insurers/${insurer.id}/deactivate`)
        .set(bearer(admin.accessToken))
        .send({ reason })
        .expect(200);
    }

    // One decision, one row. A second entry would claim a change that did not happen —
    // the same rule the no-op PATCH follows.
    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Insurer', entityId: insurer.id, action: 'UPDATE' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].afterValue).toMatchObject({
      reason: 'First decision, recorded with its own wording.',
    });
  }, 300_000);

  it('reactivates without demanding a reason, and records that too', async () => {
    const insurer = await makeLocalInsurer(`${FIXTURE_PREFIX} Back ${tag}`, {
      isActive: false,
    });
    const admin = await makeUser(
      `deact-back-${tag}`,
      'OFFICE_ADMINISTRATOR',
      'PLACEMENT_TECHNICAL_OFFICER',
    );

    // No reason: refusing to let an office undo a deactivation for want of a sentence
    // would be worse than an unexplained reactivation.
    const response = await request(app!.getHttpServer())
      .post(`/insurers/${insurer.id}/reactivate`)
      .set(bearer(admin.accessToken))
      .send({})
      .expect(200);
    expect(
      (response.body as { insurer: { isActive: boolean } }).insurer.isActive,
    ).toBe(true);

    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Insurer', entityId: insurer.id, action: 'UPDATE' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].afterValue).toMatchObject({
      isActive: true,
      reason: null,
    });

    // And the picker offers them again — the effect the flag exists for.
    const picker = await request(app!.getHttpServer())
      .get('/rfqs/selectable-insurers')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect((picker.body as { id: string }[]).map((i) => i.id)).toContain(
      insurer.id,
    );
  }, 300_000);

  it('is administrative, and an unknown insurer is absent rather than forbidden', async () => {
    const insurer = await makeLocalInsurer(`${FIXTURE_PREFIX} Gated ${tag}`);
    const reader = await makeUser(
      `deact-reader-${tag}`,
      'SALES_RELATIONSHIP_OFFICER',
    );
    const admin = await makeUser(`deact-404-${tag}`, 'OFFICE_ADMINISTRATOR');

    // `insurer.read` renders the record; changing whether the office deals with the
    // company is `insurer.relationship.manage`.
    await request(app!.getHttpServer())
      .post(`/insurers/${insurer.id}/deactivate`)
      .set(bearer(reader.accessToken))
      .send({ reason: 'A reader should not be able to do this at all.' })
      .expect(403);

    await request(app!.getHttpServer())
      .post('/insurers/00000000-0000-4000-8000-000000000000/deactivate')
      .set(bearer(admin.accessToken))
      .send({ reason: 'An id that belongs to nobody in this office.' })
      .expect(404);
  }, 300_000);
});
