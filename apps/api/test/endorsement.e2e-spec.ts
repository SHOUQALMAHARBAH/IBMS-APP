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
  schedules: {
    id: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    sourceEndorsementId: string | null;
    sumsInsured: Record<string, unknown>;
  }[];
}
interface EndorsementBody {
  id: string;
  policyId: string;
  type: string;
  changeType: string;
  status: string;
  premiumAdjustment: string;
  requestedByUserId: string;
  cancellation: {
    reason: string;
    basis: string;
    returnPremium: string;
    clientNotifiedAt: string | null;
  } | null;
  refund: {
    id: string;
    amount: string;
    raisedByUserId: string;
    approvedByUserId: string | null;
    needsApproval: boolean;
  } | null;
  commissionReversal: { amount: string } | null;
  scheduleVersioned: boolean;
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
    .send({ fullName: 'Endorsement E2E User', email, password: PASSWORD })
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

async function buildOpportunity(
  ownerUserId: string,
  tag: string,
): Promise<{ opportunityId: string; rfqId: string; insurerId: string }> {
  const rand = Math.random().toString(36).slice(2, 8);
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `Endorsement E2E ${tag} ${rand}`,
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
    data: { name: `Endorsement E2E ${tag} ins ${rand}` },
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

/** Place + issue + check + deliver + acknowledge — an ACTIVE policy with an
 * explicit period, ready for a Process 22 endorsement. `commissionRatePercent`
 * on the placed quote is 12 (drives the commission reversal). */
async function activePolicy(
  app: INestApplication<App>,
  placerToken: string,
  checkerToken: string,
  ownerUserId: string,
  tag: string,
  period: { inceptionDate: string; expiryDate: string },
): Promise<{ policyId: string }> {
  const { opportunityId, rfqId, insurerId } = await buildOpportunity(
    ownerUserId,
    tag,
  );
  const quote = await request(app.getHttpServer())
    .post('/quotations')
    .set(bearer(placerToken))
    .send({
      rfqId,
      insurerId,
      premium: '120000.000',
      commissionRatePercent: '12',
    })
    .expect(201);
  const drafted = await request(app.getHttpServer())
    .post('/recommendations')
    .set(bearer(placerToken))
    .send({
      opportunityId,
      recommendedQuotationId: (quote.body as QuotationChainBody).current.id,
      rationale: 'A long enough written summary to pass the length check.',
      rationaleFactors: FACTORS,
    })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/recommendations/${(drafted.body as { id: string }).id}/send`)
    .set(bearer(placerToken))
    .expect(201);
  await request(app.getHttpServer())
    .post('/client-decisions')
    .set(bearer(placerToken))
    .send({
      opportunityId,
      decision: 'ACCEPT',
      evidenceType: 'e-signature',
      evidenceRef: `env-${tag}`,
    })
    .expect(201);

  const placed = await request(app.getHttpServer())
    .post('/policies')
    .set(bearer(placerToken))
    .send({ opportunityId, ...period })
    .expect(201);
  const policyId = (placed.body as PolicyBody).id;
  const policyNumber = `POL-END-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/issuance`)
    .set(bearer(placerToken))
    .send({
      policyNumber,
      issuedPremium: '120000.000',
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

async function advanceToInsurerConfirmed(
  app: INestApplication<App>,
  token: string,
  endorsementId: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post(`/endorsements/${endorsementId}/advance`)
    .set(bearer(token))
    .send({})
    .expect(201);
  await request(app.getHttpServer())
    .post(`/endorsements/${endorsementId}/advance`)
    .set(bearer(token))
    .send({})
    .expect(201);
}

describe('Endorsement Management (e2e) — backlog Part C #22', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('positive endorsement: walks the lifecycle, applies the insurer-confirmed premium, and opens a NEW schedule version', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'end-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'end-chk', 'POLICY_CHECKING_OFFICER');

    const { policyId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'pos',
      { inceptionDate: '2026-10-01', expiryDate: '2027-10-01' },
    );

    const requested = await request(app.getHttpServer())
      .post(`/policies/${policyId}/endorsements`)
      .set(bearer(plc.accessToken))
      .send({
        type: 'POSITIVE',
        changeType: 'sum_insured_increase',
        premiumAmount: '2500.000',
        effectiveFrom: '2026-12-01',
        targetCoverage: {
          limits: { buildings: '6500000.000', contents: '1200000.000' },
          sumsInsured: { total: '7700000.000' },
          namedPerils: ['fire', 'flood', 'theft'],
          extensions: ['debris removal'],
        },
      })
      .expect(201);
    const endo = requested.body as EndorsementBody;
    expect(endo.status).toBe('REQUESTED');
    expect(endo.type).toBe('POSITIVE');
    expect(endo.premiumAdjustment).toBe('2500.000');
    expect(endo.requestedByUserId).toBe(plc.userId);

    await advanceToInsurerConfirmed(app, plc.accessToken, endo.id);

    // the insurer finally confirmed a slightly higher figure
    const calculated = await request(app.getHttpServer())
      .post(`/endorsements/${endo.id}/calculate-adjustment`)
      .set(bearer(plc.accessToken))
      .send({ premiumAmount: '2600.000' })
      .expect(201);
    const cBody = calculated.body as EndorsementBody;
    expect(cBody.status).toBe('FINANCIAL_ADJUSTMENT_CALCULATED');
    expect(cBody.premiumAdjustment).toBe('2600.000');
    expect(cBody.refund).toBeNull();
    expect(cBody.commissionReversal).toBeNull();

    const applied = await request(app.getHttpServer())
      .post(`/endorsements/${endo.id}/apply`)
      .set(bearer(plc.accessToken))
      .expect(201);
    expect((applied.body as EndorsementBody).status).toBe('APPLIED');
    expect((applied.body as EndorsementBody).scheduleVersioned).toBe(true);

    // the prior schedule is closed at the endorsement date, a new one opens
    const policy = await request(app.getHttpServer())
      .get(`/policies/${policyId}`)
      .set(bearer(plc.accessToken))
      .expect(200);
    const schedules = (policy.body as PolicyBody).schedules;
    expect(schedules).toHaveLength(2);
    const opened = schedules.find((s) => s.sourceEndorsementId === endo.id);
    const closed = schedules.find((s) => s.sourceEndorsementId === null);
    expect(opened).toBeDefined();
    expect(opened?.effectiveTo).toBeNull();
    expect(opened?.sumsInsured).toMatchObject({ total: '7700000.000' });
    expect(closed?.effectiveTo).not.toBeNull();

    await request(app.getHttpServer())
      .post(`/endorsements/${endo.id}/notify-client`)
      .set(bearer(plc.accessToken))
      .expect(201);

    // every status move went through the engine: REQUESTED->SUBMITTED_TO_INSURER
    // ->INSURER_CONFIRMED->FINANCIAL_ADJUSTMENT_CALCULATED->APPLIED->CLIENT_NOTIFIED
    const rows = await prisma.auditLogEntry.count({
      where: {
        entityType: 'Endorsement',
        entityId: endo.id,
        action: 'TRANSITION',
      },
    });
    expect(rows).toBe(5);
  });

  it('negative endorsement above the threshold: refund is maker/checker-gated; the raiser cannot self-approve', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'end-neg-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'end-neg-chk', 'POLICY_CHECKING_OFFICER');
    const mgr = await makeUser(app, 'end-neg-mgr', 'BRANCH_DEPARTMENT_MANAGER');

    const { policyId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'neg',
      { inceptionDate: '2026-10-01', expiryDate: '2027-10-01' },
    );

    const requested = await request(app.getHttpServer())
      .post(`/policies/${policyId}/endorsements`)
      .set(bearer(plc.accessToken))
      .send({
        type: 'NEGATIVE',
        changeType: 'remove_vehicle',
        premiumAmount: '9000.000',
        effectiveFrom: '2026-12-01',
      })
      .expect(201);
    const endo = requested.body as EndorsementBody;
    expect(endo.premiumAdjustment).toBe('-9000.000');

    await advanceToInsurerConfirmed(app, plc.accessToken, endo.id);

    const calculated = await request(app.getHttpServer())
      .post(`/endorsements/${endo.id}/calculate-adjustment`)
      .set(bearer(plc.accessToken))
      .send({})
      .expect(201);
    const cBody = calculated.body as EndorsementBody;
    expect(cBody.status).toBe('REFUND_APPROVAL_PENDING');
    expect(cBody.refund?.needsApproval).toBe(true);
    expect(cBody.refund?.amount).toBe('9000.000');
    expect(cBody.refund?.raisedByUserId).toBe(plc.userId);
    // commission reversal tied 1:1: 9000.000 × 12% = 1080.000
    expect(cBody.commissionReversal?.amount).toBe('1080.000');

    // cannot apply directly while an approval is pending
    await request(app.getHttpServer())
      .post(`/endorsements/${endo.id}/apply`)
      .set(bearer(plc.accessToken))
      .expect(422);

    const refundId = cBody.refund?.id as string;
    // maker/checker: the officer who raised it cannot approve it
    await request(app.getHttpServer())
      .post(`/refunds/${refundId}/approve`)
      .set(bearer(plc.accessToken))
      .expect(403);

    const approved = await request(app.getHttpServer())
      .post(`/refunds/${refundId}/approve`)
      .set(bearer(mgr.accessToken))
      .expect(201);
    const aBody = approved.body as EndorsementBody;
    expect(aBody.status).toBe('APPLIED');
    expect(aBody.refund?.approvedByUserId).toBe(mgr.userId);
    expect(aBody.scheduleVersioned).toBe(true);

    // a second approval is refused
    await request(app.getHttpServer())
      .post(`/refunds/${refundId}/approve`)
      .set(bearer(mgr.accessToken))
      .expect(422);
  });

  it('cancellation: pro-rata return premium, auto-clears below the threshold, applies and cancels the Policy', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'end-canc-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'end-canc-chk', 'POLICY_CHECKING_OFFICER');

    const { policyId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'canc',
      { inceptionDate: '2026-10-01', expiryDate: '2027-10-01' },
    );

    // cancel ~6 days before expiry -> 120000 × 6/365 ≈ 1972 (< 5000 threshold)
    const requested = await request(app.getHttpServer())
      .post(`/policies/${policyId}/cancellation`)
      .set(bearer(plc.accessToken))
      .send({
        reason: 'Client sold the insured premises and no longer needs cover.',
        basis: 'pro_rata',
        effectiveFrom: '2027-09-25',
      })
      .expect(201);
    const endo = requested.body as EndorsementBody;
    expect(endo.type).toBe('NEGATIVE');
    expect(endo.changeType).toBe('cancellation');
    expect(endo.cancellation?.basis).toBe('pro_rata');
    expect(Number(endo.cancellation?.returnPremium)).toBeGreaterThan(0);
    expect(Number(endo.cancellation?.returnPremium)).toBeLessThan(5000);
    expect(endo.premiumAdjustment.startsWith('-')).toBe(true);

    await advanceToInsurerConfirmed(app, plc.accessToken, endo.id);

    const calculated = await request(app.getHttpServer())
      .post(`/endorsements/${endo.id}/calculate-adjustment`)
      .set(bearer(plc.accessToken))
      .send({})
      .expect(201);
    const cBody = calculated.body as EndorsementBody;
    expect(cBody.status).toBe('FINANCIAL_ADJUSTMENT_CALCULATED');
    expect(cBody.refund?.needsApproval).toBe(false);
    expect(cBody.commissionReversal).not.toBeNull();

    const applied = await request(app.getHttpServer())
      .post(`/endorsements/${endo.id}/apply`)
      .set(bearer(plc.accessToken))
      .expect(201);
    expect((applied.body as EndorsementBody).status).toBe('APPLIED');
    // cover ends — no successor schedule
    expect((applied.body as EndorsementBody).scheduleVersioned).toBe(false);

    const policy = await request(app.getHttpServer())
      .get(`/policies/${policyId}`)
      .set(bearer(plc.accessToken))
      .expect(200);
    expect((policy.body as PolicyBody).status).toBe('CANCELLED');

    const notified = await request(app.getHttpServer())
      .post(`/endorsements/${endo.id}/notify-client`)
      .set(bearer(plc.accessToken))
      .expect(201);
    expect(
      (notified.body as EndorsementBody).cancellation?.clientNotifiedAt,
    ).not.toBeNull();

    const list = await request(app.getHttpServer())
      .get(`/policies/${policyId}/endorsements`)
      .set(bearer(plc.accessToken))
      .expect(200);
    expect(list.body as EndorsementBody[]).toHaveLength(1);
  });

  it('rejects an endorsement on a policy that is not ACTIVE', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'end-inactive-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // build only as far as PLACEMENT_CONFIRMED (never issued / made ACTIVE)
    const { opportunityId, rfqId, insurerId } = await buildOpportunity(
      plc.userId,
      'inactive',
    );
    const quote = await request(app.getHttpServer())
      .post('/quotations')
      .set(bearer(plc.accessToken))
      .send({
        rfqId,
        insurerId,
        premium: '120000.000',
        commissionRatePercent: '12',
      })
      .expect(201);
    const drafted = await request(app.getHttpServer())
      .post('/recommendations')
      .set(bearer(plc.accessToken))
      .send({
        opportunityId,
        recommendedQuotationId: (quote.body as QuotationChainBody).current.id,
        rationale: 'A long enough written summary to pass the length check.',
        rationaleFactors: FACTORS,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/recommendations/${(drafted.body as { id: string }).id}/send`)
      .set(bearer(plc.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post('/client-decisions')
      .set(bearer(plc.accessToken))
      .send({
        opportunityId,
        decision: 'ACCEPT',
        evidenceType: 'e-signature',
        evidenceRef: 'env-inactive',
      })
      .expect(201);
    const placed = await request(app.getHttpServer())
      .post('/policies')
      .set(bearer(plc.accessToken))
      .send({
        opportunityId,
        inceptionDate: '2026-10-01',
        expiryDate: '2027-10-01',
      })
      .expect(201);
    const policyId = (placed.body as PolicyBody).id;

    await request(app.getHttpServer())
      .post(`/policies/${policyId}/endorsements`)
      .set(bearer(plc.accessToken))
      .send({
        type: 'POSITIVE',
        changeType: 'address_change',
        premiumAmount: '0.000',
        effectiveFrom: '2026-12-01',
      })
      .expect(422);
  });
});
