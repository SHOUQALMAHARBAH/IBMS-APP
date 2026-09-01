import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
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
interface QuotationChainBody {
  current: { id: string };
}
interface PolicyBody {
  id: string;
  status: string;
  insurerId: string;
  insuranceLine: string;
  policyNumber: string | null;
  requestedPremium: string;
  issuedPremium: string | null;
  premiumVariance: string | null;
  currency: string;
  placedByUserId: string | null;
  issuedByUserId: string | null;
  schedules: { id: string; effectiveFrom: string; namedPerils: string[] }[];
  documents: { id: string; category: string; classification: string }[];
  issuanceComplete: boolean;
  checkingComplete: boolean;
  deliveryComplete: boolean;
  checking: {
    placedByUserId: string;
    checkedByUserId: string | null;
    discrepancyFound: boolean;
    discrepancyLoggedAsPiRiskEvent: boolean;
    discrepancyDetail: string | null;
  } | null;
  delivery: {
    deliveredAt: string;
    method: string;
    recipient: string;
    receiptAcknowledgedAt: string | null;
  } | null;
}

const ISSUED_SCHEDULE = {
  limits: { buildings: '5000000.000', contents: '1200000.000' },
  sumsInsured: { total: '6200000.000' },
  namedPerils: ['fire', 'flood', 'theft'],
  extensions: ['debris removal'],
};

const FACTORS = {
  coverage: 'Matches every requested peril plus the two extensions.',
  price: 'Lowest premium of the shortlist.',
  financialStrength: 'A- rated carrier, adequate for this exposure.',
  claimsService: 'Local adjuster panel, ten-day average settlement.',
  deductible: 'JOD 1,000, in line with the market for this class.',
  policyConditions: 'No unusual warranties; standard subrogation clause.',
};

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
    .send({ fullName: 'Policy E2E User', email, password: PASSWORD })
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
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: { revokedAt: null },
      create: { userId: user.id, roleId: role.id },
    });
  }
  return { accessToken, userId: user.id };
}

/** A COMPARISON_BUILT Opportunity with one RFQ + one shortlisted insurer. */
async function buildOpportunity(
  ownerUserId: string,
  tag: string,
): Promise<{ opportunityId: string; rfqId: string; insurerId: string }> {
  const rand = Math.random().toString(36).slice(2, 8);
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `Policy E2E ${tag} ${rand}`,
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
  const insurer = await prisma.insurer.create({
    data: { name: `Policy E2E ${tag} ins ${rand}` },
  });
  await prisma.rFQInsurer.create({
    data: { rfqId: rfq.id, insurerId: insurer.id, status: 'SENT' },
  });
  return {
    opportunityId: opportunity.id,
    rfqId: rfq.id,
    insurerId: insurer.id,
  };
}

/** Drive an Opportunity to SENT_TO_CLIENT (single quote -> no #16 gates). */
async function opportunityWithSentRecommendation(
  app: INestApplication<App>,
  token: string,
  ownerUserId: string,
  tag: string,
): Promise<{ opportunityId: string; insurerId: string }> {
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
      premium: '120000.000',
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
  await request(app.getHttpServer())
    .post(`/recommendations/${(drafted.body as { id: string }).id}/send`)
    .set(bearer(token))
    .expect(201);
  return { opportunityId, insurerId };
}

/** ... plus a captured ACCEPT client decision, leaving the Opportunity ready
 * to place. */
async function acceptedOpportunity(
  app: INestApplication<App>,
  token: string,
  ownerUserId: string,
  tag: string,
): Promise<{ opportunityId: string; insurerId: string }> {
  const { opportunityId, insurerId } = await opportunityWithSentRecommendation(
    app,
    token,
    ownerUserId,
    tag,
  );
  await request(app.getHttpServer())
    .post('/client-decisions')
    .set(bearer(token))
    .send({
      opportunityId,
      decision: 'ACCEPT',
      evidenceType: 'e-signature',
      evidenceRef: `env-${tag}`,
    })
    .expect(201);
  return { opportunityId, insurerId };
}

/** Place + issue a policy (with ISSUED_SCHEDULE coverage), leaving it at
 * ISSUED and ready for the Process 20 quality-control check. */
async function issuedPolicy(
  app: INestApplication<App>,
  token: string,
  ownerUserId: string,
  tag: string,
): Promise<string> {
  const { opportunityId } = await acceptedOpportunity(
    app,
    token,
    ownerUserId,
    tag,
  );
  const placed = await request(app.getHttpServer())
    .post('/policies')
    .set(bearer(token))
    .send({ opportunityId, inceptionDate: '2026-10-01' })
    .expect(201);
  const policyId = (placed.body as PolicyBody).id;
  const policyNumber = `POL-CHK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/issuance`)
    .set(bearer(token))
    .send({
      policyNumber,
      issuedPremium: '120000.000',
      schedule: ISSUED_SCHEDULE,
      documents: [],
    })
    .expect(201);
  return policyId;
}

/** ... plus a clean Process 20 check by `checkerToken` (a different officer),
 * leaving the policy at VERIFIED and ready for Process 21 delivery. */
async function verifiedPolicy(
  app: INestApplication<App>,
  placerToken: string,
  checkerToken: string,
  ownerUserId: string,
  tag: string,
): Promise<string> {
  const policyId = await issuedPolicy(app, placerToken, ownerUserId, tag);
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/checking`)
    .set(bearer(checkerToken))
    .send({ requestedCoverage: ISSUED_SCHEDULE })
    .expect(201);
  return policyId;
}

describe('Policy Placement & Issuance (e2e) — backlog Part C #18-19', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('places a policy from an accepted opportunity, records issuance, and attaches later documents', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'pol-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const { opportunityId, insurerId } = await acceptedOpportunity(
      app,
      plc.accessToken,
      plc.userId,
      'happy',
    );
    // Policy.policyNumber is @unique across the whole shared db-test (no
    // per-file isolation, see vitest-e2e.config.ts) — unique it per run the
    // same way uniqueEmail() does for signups.
    const policyNumber = `POL-E2E-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // #18 — place
    const placed = await request(app.getHttpServer())
      .post('/policies')
      .set(bearer(plc.accessToken))
      .send({
        opportunityId,
        inceptionDate: '2026-10-01',
        expiryDate: '2027-10-01',
      })
      .expect(201);
    const policy = placed.body as PolicyBody;
    expect(policy.status).toBe('PLACEMENT_CONFIRMED');
    expect(policy.insurerId).toBe(insurerId);
    expect(policy.insuranceLine).toBe('Property All Risks');
    expect(policy.requestedPremium).toBe('120000.000');
    expect(policy.issuedPremium).toBeNull();
    expect(policy.premiumVariance).toBeNull();
    expect(policy.placedByUserId).toBe(plc.userId);
    expect(policy.issuanceComplete).toBe(false);

    // one policy per opportunity
    await request(app.getHttpServer())
      .post('/policies')
      .set(bearer(plc.accessToken))
      .send({ opportunityId, inceptionDate: '2026-10-01' })
      .expect(409);

    // #19 — record issuance
    const issued = await request(app.getHttpServer())
      .post(`/policies/${policy.id}/issuance`)
      .set(bearer(plc.accessToken))
      .send({
        policyNumber,
        issuedPremium: '118500.000',
        schedule: {
          limits: { buildings: '5000000.000', contents: '1200000.000' },
          sumsInsured: { total: '6200000.000' },
          namedPerils: ['fire', 'flood', 'theft'],
          extensions: ['debris removal'],
        },
        documents: [
          {
            category: 'POLICY',
            classification: 'CONFIDENTIAL',
            fileName: 'wording.pdf',
            storageRef: `s3://ibms/${policyNumber}/wording.pdf`,
          },
          {
            category: 'INVOICE',
            classification: 'CONFIDENTIAL',
            fileName: 'premium-invoice.pdf',
            storageRef: `s3://ibms/${policyNumber}/invoice.pdf`,
          },
        ],
      })
      .expect(201);
    const issuedPolicy = issued.body as PolicyBody;
    expect(issuedPolicy.status).toBe('ISSUED');
    expect(issuedPolicy.policyNumber).toBe(policyNumber);
    expect(issuedPolicy.issuedPremium).toBe('118500.000');
    expect(issuedPolicy.premiumVariance).toBe('-1500.000');
    expect(issuedPolicy.issuedByUserId).toBe(plc.userId);
    expect(issuedPolicy.schedules).toHaveLength(1);
    expect(issuedPolicy.schedules[0].namedPerils).toEqual([
      'fire',
      'flood',
      'theft',
    ]);
    expect(issuedPolicy.documents).toHaveLength(2);
    expect(issuedPolicy.issuanceComplete).toBe(true);

    // issuance is recorded once
    await request(app.getHttpServer())
      .post(`/policies/${policy.id}/issuance`)
      .set(bearer(plc.accessToken))
      .send({
        policyNumber,
        issuedPremium: '118500.000',
        schedule: { limits: { buildings: '1' }, sumsInsured: { total: '1' } },
        documents: [],
      })
      .expect(422);

    // a certificate arrives later — attach it to the electronic file
    const withCert = await request(app.getHttpServer())
      .post(`/policies/${policy.id}/documents`)
      .set(bearer(plc.accessToken))
      .send({
        documents: [
          {
            category: 'POLICY',
            classification: 'CONFIDENTIAL',
            fileName: 'certificate-of-insurance.pdf',
            storageRef: `s3://ibms/${policyNumber}/coi.pdf`,
          },
        ],
      })
      .expect(201);
    expect((withCert.body as PolicyBody).documents).toHaveLength(3);

    // read paths
    const list = await request(app.getHttpServer())
      .get(`/policies?opportunityId=${opportunityId}`)
      .set(bearer(plc.accessToken))
      .expect(200);
    expect(list.body as PolicyBody[]).toHaveLength(1);
    await request(app.getHttpServer())
      .get(`/policies/${policy.id}`)
      .set(bearer(plc.accessToken))
      .expect(200);

    // the ISSUED transition wrote a TRANSITION audit row
    const transitionRows = await prisma.auditLogEntry.count({
      where: {
        entityType: 'Policy',
        entityId: policy.id,
        action: 'TRANSITION',
      },
    });
    expect(transitionRows).toBe(1);
  });

  it('422s a placement with no ACCEPT decision, and validates the placement body', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'pol-plc2',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // sent recommendation but the client has NOT decided
    const { opportunityId } = await opportunityWithSentRecommendation(
      app,
      plc.accessToken,
      plc.userId,
      'nodecision',
    );
    await request(app.getHttpServer())
      .post('/policies')
      .set(bearer(plc.accessToken))
      .send({ opportunityId, inceptionDate: '2026-10-01' })
      .expect(422);

    // missing inceptionDate -> 400 (DTO validation)
    const accepted = await acceptedOpportunity(
      app,
      plc.accessToken,
      plc.userId,
      'badbody',
    );
    await request(app.getHttpServer())
      .post('/policies')
      .set(bearer(plc.accessToken))
      .send({ opportunityId: accepted.opportunityId })
      .expect(400);
  });

  it('Process 20 — a checker (not the placing officer) verifies a clean policy and rejects a discrepant one, logging a PI risk event', async () => {
    const app = await boot();
    // dual-hatted: holds policy.check too, so the 403 below is the
    // assertDifferentActors maker/checker rejection, not the RBAC guard
    const plc = await makeUser(
      app,
      'chk-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
      'POLICY_CHECKING_OFFICER',
    );
    const chk = await makeUser(app, 'chk-off', 'POLICY_CHECKING_OFFICER');

    // --- clean check -> VERIFIED ---
    const cleanId = await issuedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'clean',
    );

    // maker/checker: the officer who placed the cover cannot check it — even
    // though this user now holds policy.check, assertDifferentActors rejects
    // it because they are the placing officer
    await request(app.getHttpServer())
      .post(`/policies/${cleanId}/checking`)
      .set(bearer(plc.accessToken))
      .send({ requestedCoverage: ISSUED_SCHEDULE })
      .expect(403);

    const verified = await request(app.getHttpServer())
      .post(`/policies/${cleanId}/checking`)
      .set(bearer(chk.accessToken))
      .send({ requestedCoverage: ISSUED_SCHEDULE })
      .expect(201);
    const vBody = verified.body as PolicyBody;
    expect(vBody.status).toBe('VERIFIED');
    expect(vBody.checkingComplete).toBe(true);
    expect(vBody.checking?.discrepancyFound).toBe(false);
    expect(vBody.checking?.checkedByUserId).toBe(chk.userId);
    expect(vBody.checking?.placedByUserId).toBe(plc.userId);

    // --- discrepant check -> DISCREPANCY + a PI risk event ---
    const dirtyId = await issuedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'dirty',
    );
    const discrepant = await request(app.getHttpServer())
      .post(`/policies/${dirtyId}/checking`)
      .set(bearer(chk.accessToken))
      .send({
        requestedCoverage: {
          ...ISSUED_SCHEDULE,
          // requested JOD 5m buildings, but the insurer issued the same 5m —
          // so change a figure the checker believes was agreed higher
          limits: { buildings: '8000000.000', contents: '1200000.000' },
          namedPerils: ['fire', 'flood', 'theft', 'storm'],
        },
      })
      .expect(201);
    const dBody = discrepant.body as PolicyBody;
    expect(dBody.status).toBe('DISCREPANCY');
    expect(dBody.checking?.discrepancyFound).toBe(true);
    expect(dBody.checking?.discrepancyLoggedAsPiRiskEvent).toBe(true);
    expect(dBody.checking?.discrepancyDetail).toContain('limits.buildings');

    // the PI risk event exists and links back to this checking row
    const checkingRow = await prisma.policyChecking.findUnique({
      where: { policyId: dirtyId },
    });
    const piEvents = await prisma.professionalIndemnityRiskEvent.findMany({
      where: { sourcePolicyCheckingId: checkingRow?.id },
    });
    expect(piEvents).toHaveLength(1);
    expect(piEvents[0].description).toContain('Policy-checking discrepancy');

    // a re-check that still finds a discrepancy does not double-log — but if
    // the discrepancy detail materially changed, the existing PI risk event's
    // description is refreshed (it must not go stale)
    await request(app.getHttpServer())
      .post(`/policies/${dirtyId}/checking`)
      .set(bearer(chk.accessToken))
      .send({
        requestedCoverage: {
          ...ISSUED_SCHEDULE,
          limits: { buildings: '9500000.000', contents: '1200000.000' },
        },
      })
      .expect(201);
    const piEventsAfter = await prisma.professionalIndemnityRiskEvent.findMany({
      where: { sourcePolicyCheckingId: checkingRow?.id },
    });
    expect(piEventsAfter).toHaveLength(1);
    expect(piEventsAfter[0].description).toContain('9500000.000');

    // Delivery is structurally blocked from DISCREPANCY — the engine map has
    // no DISCREPANCY -> DELIVERED edge. A re-check with the correct requested
    // coverage clears it to VERIFIED.
    const cleared = await request(app.getHttpServer())
      .post(`/policies/${dirtyId}/checking`)
      .set(bearer(chk.accessToken))
      .send({ requestedCoverage: ISSUED_SCHEDULE })
      .expect(201);
    expect((cleared.body as PolicyBody).status).toBe('VERIFIED');
  });

  it('Process 21 — records delivery of a VERIFIED policy and the client receipt acknowledgement, driving it to ACTIVE', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'del-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'del-chk', 'POLICY_CHECKING_OFFICER');

    // delivery is refused before the policy is VERIFIED
    const issuedId = await issuedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'del-early',
    );
    await request(app.getHttpServer())
      .post(`/policies/${issuedId}/delivery`)
      .set(bearer(plc.accessToken))
      .send({ method: 'email', recipient: 'ops@acme.test' })
      .expect(422);

    const policyId = await verifiedPolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'del-happy',
    );

    const delivered = await request(app.getHttpServer())
      .post(`/policies/${policyId}/delivery`)
      .set(bearer(plc.accessToken))
      .send({ method: 'courier', recipient: 'Acme Risk Dept' })
      .expect(201);
    const dBody = delivered.body as PolicyBody;
    expect(dBody.status).toBe('DELIVERED');
    expect(dBody.delivery?.method).toBe('courier');
    expect(dBody.delivery?.recipient).toBe('Acme Risk Dept');
    expect(dBody.delivery?.receiptAcknowledgedAt).toBeNull();
    expect(dBody.deliveryComplete).toBe(false);

    // one delivery per policy
    await request(app.getHttpServer())
      .post(`/policies/${policyId}/delivery`)
      .set(bearer(plc.accessToken))
      .send({ method: 'email', recipient: 'x@y.test' })
      .expect(422);

    // an acknowledgement dated before the delivery is rejected
    await request(app.getHttpServer())
      .post(`/policies/${policyId}/delivery/acknowledge-receipt`)
      .set(bearer(plc.accessToken))
      .send({ acknowledgedAt: '2020-01-01T00:00:00Z' })
      .expect(422);

    const acked = await request(app.getHttpServer())
      .post(`/policies/${policyId}/delivery/acknowledge-receipt`)
      .set(bearer(plc.accessToken))
      .send({})
      .expect(201);
    const aBody = acked.body as PolicyBody;
    expect(aBody.status).toBe('ACTIVE');
    expect(aBody.delivery?.receiptAcknowledgedAt).not.toBeNull();
    expect(aBody.deliveryComplete).toBe(true);

    // a second acknowledgement is a 409
    await request(app.getHttpServer())
      .post(`/policies/${policyId}/delivery/acknowledge-receipt`)
      .set(bearer(plc.accessToken))
      .send({})
      .expect(409);

    // every Policy status move went through the engine and wrote a TRANSITION
    // audit row — PLACEMENT_CONFIRMED->ISSUED (#19), ISSUED->CHECKING_IN_PROGRESS
    // ->VERIFIED (#20), then VERIFIED->DELIVERED->ACTIVE (#21): 5 rows. A
    // direct `.status =` write anywhere in that chain would drop the count.
    const transitionRows = await prisma.auditLogEntry.count({
      where: { entityType: 'Policy', entityId: policyId, action: 'TRANSITION' },
    });
    expect(transitionRows).toBe(5);
  });
});
