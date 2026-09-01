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
interface RecommendationBody {
  id: string;
  approvalRequired: boolean;
  conflictOfInterestFlagged: boolean;
  coiCompetingQuotationId: string | null;
  coiCommissionDiffPercent: string | null;
  approvedByUserId: string | null;
  sentToClientAt: string | null;
  blockedFromSend: string[];
  conflictOfInterestDisclosure: { id: string } | null;
}

const FACTORS = {
  coverage: 'Matches every requested peril plus the two extensions.',
  price: 'Second lowest premium; 4% above the cheapest quote.',
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
    .send({ fullName: 'Recommendation E2E User', email, password: PASSWORD })
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

/** Build a COMPARISON_BUILT Opportunity owned by `ownerUserId` with an RFQ
 * and the given insurers shortlisted. Returns ids to hang quotes / a
 * recommendation off. */
async function buildOpportunity(
  ownerUserId: string,
  insurerCount: number,
  tag: string,
): Promise<{ opportunityId: string; rfqId: string; insurerIds: string[] }> {
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `Rec E2E ${tag} ${Math.random().toString(36).slice(2, 8)}`,
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
  const insurerIds: string[] = [];
  for (let i = 0; i < insurerCount; i += 1) {
    const insurer = await prisma.insurer.create({
      data: {
        name: `Rec E2E ${tag} ins ${i} ${Math.random().toString(36).slice(2, 6)}`,
      },
    });
    await prisma.rFQInsurer.create({
      data: { rfqId: rfq.id, insurerId: insurer.id, status: 'SENT' },
    });
    insurerIds.push(insurer.id);
  }
  return { opportunityId: opportunity.id, rfqId: rfq.id, insurerIds };
}

async function captureQuote(
  app: INestApplication<App>,
  token: string,
  rfqId: string,
  insurerId: string,
  premium: string,
  commissionRatePercent: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/quotations')
    .set(bearer(token))
    .send({ rfqId, insurerId, premium, commissionRatePercent })
    .expect(201);
  return (res.body as QuotationChainBody).current.id;
}

describe('Broker Recommendation (e2e) — backlog Part C #16', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('runs the full gated path: threshold -> draft -> approval -> COI disclosure -> send', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'rec-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    const manager = await makeUser(app, 'rec-mgr', 'BRANCH_DEPARTMENT_MANAGER');
    const compliance = await makeUser(app, 'rec-cmp', 'COMPLIANCE_OFFICER');

    const { opportunityId, rfqId, insurerIds } = await buildOpportunity(
      placement.userId,
      2,
      'full',
    );
    // recommended: higher premium, much higher commission
    const recommendedQuotationId = await captureQuote(
      app,
      placement.accessToken,
      rfqId,
      insurerIds[0],
      '260000.000',
      '17.5',
    );
    // comparable competitor (within 10% band) on far less commission
    await captureQuote(
      app,
      placement.accessToken,
      rfqId,
      insurerIds[1],
      '255000.000',
      '10',
    );

    // 1. Manager sets the approval threshold below the recommended premium.
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}/target-premium-threshold`)
      .set(bearer(manager.accessToken))
      .send({ targetPremiumThreshold: '250000.000' })
      .expect(200);
    // A Placement Officer cannot set it.
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}/target-premium-threshold`)
      .set(bearer(placement.accessToken))
      .send({ targetPremiumThreshold: '1.000' })
      .expect(403);

    // 2. Draft — both gate flags snapshot true.
    const drafted = await request(app.getHttpServer())
      .post('/recommendations')
      .set(bearer(placement.accessToken))
      .send({
        opportunityId,
        recommendedQuotationId,
        rationale:
          'Insurer A on balance of coverage breadth and claims service despite the premium.',
        rationaleFactors: FACTORS,
      })
      .expect(201);
    const rec = drafted.body as RecommendationBody;
    expect(rec.approvalRequired).toBe(true);
    expect(rec.conflictOfInterestFlagged).toBe(true);
    expect(rec.coiCommissionDiffPercent).toBe('7.50');
    expect(rec.blockedFromSend).toHaveLength(2);

    // 3. Send refused — both gates stand.
    await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/send`)
      .set(bearer(placement.accessToken))
      .expect(422);

    // 4. Placement has no recommendation.approve grant.
    await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/approve`)
      .set(bearer(placement.accessToken))
      .expect(403);

    // 5. Manager (≠ drafter) approves.
    const approved = await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/approve`)
      .set(bearer(manager.accessToken))
      .expect(201);
    expect(
      (approved.body as RecommendationBody).approvedByUserId,
    ).not.toBeNull();
    expect((approved.body as RecommendationBody).blockedFromSend).toEqual([
      'A conflict-of-interest disclosure is required before this recommendation can be sent.',
    ]);

    // 6. Still blocked — COI disclosure outstanding.
    await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/send`)
      .set(bearer(placement.accessToken))
      .expect(422);

    // 7. Compliance records the disclosure (≠ drafter).
    const disclosed = await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/conflict-of-interest-disclosure`)
      .set(bearer(compliance.accessToken))
      .send({
        disclosureText:
          'Insurer A pays 7.5 percentage points more commission than the comparable Insurer B quote; disclosed to the client in writing.',
      })
      .expect(201);
    expect(
      (disclosed.body as RecommendationBody).conflictOfInterestDisclosure,
    ).not.toBeNull();
    expect((disclosed.body as RecommendationBody).blockedFromSend).toHaveLength(
      0,
    );

    // 8. Send succeeds; the Opportunity advances.
    const sent = await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/send`)
      .set(bearer(placement.accessToken))
      .expect(201);
    expect((sent.body as RecommendationBody).sentToClientAt).not.toBeNull();

    const opp = await request(app.getHttpServer())
      .get(`/opportunities/${opportunityId}`)
      .set(bearer(placement.accessToken))
      .expect(200);
    expect((opp.body as { status: string }).status).toBe('SENT_TO_CLIENT');

    // A second send is a 409.
    await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/send`)
      .set(bearer(placement.accessToken))
      .expect(409);
  });

  it('refuses a self-approval (maker/checker) and a disclosure on an unflagged recommendation', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'rec2-mgr',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const compliance = await makeUser(app, 'rec2-cmp', 'COMPLIANCE_OFFICER');
    // dual-hatted: can BOTH draft (Placement) and approve (Manager)
    const dual = await makeUser(
      app,
      'rec2-dual',
      'PLACEMENT_TECHNICAL_OFFICER',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    const { opportunityId, rfqId, insurerIds } = await buildOpportunity(
      dual.userId,
      1,
      'mc',
    );
    const quotationId = await captureQuote(
      app,
      dual.accessToken,
      rfqId,
      insurerIds[0],
      '300000.000',
      '12',
    );
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}/target-premium-threshold`)
      .set(bearer(manager.accessToken))
      .send({ targetPremiumThreshold: '100000.000' })
      .expect(200);

    const drafted = await request(app.getHttpServer())
      .post('/recommendations')
      .set(bearer(dual.accessToken))
      .send({
        opportunityId,
        recommendedQuotationId: quotationId,
        rationale: 'A long enough written summary to pass the length check.',
        rationaleFactors: FACTORS,
      })
      .expect(201);
    const rec = drafted.body as RecommendationBody;
    expect(rec.approvalRequired).toBe(true);
    expect(rec.conflictOfInterestFlagged).toBe(false); // only one quote

    // the dual-hatted DRAFTER holds recommendation.approve but is the maker —
    // assertDifferentActors (+ the CHECK constraint) refuse the self-approval.
    await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/approve`)
      .set(bearer(dual.accessToken))
      .expect(403);

    // an unflagged recommendation needs no COI disclosure.
    await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/conflict-of-interest-disclosure`)
      .set(bearer(compliance.accessToken))
      .send({ disclosureText: 'x'.repeat(25) })
      .expect(422);
  });

  it('re-derives the approval gate from live data — a threshold set AFTER the draft still blocks the send', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'rec3-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    const manager = await makeUser(
      app,
      'rec3-mgr',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    const { rfqId, insurerIds, opportunityId } = await buildOpportunity(
      placement.userId,
      1,
      'live',
    );
    const quotationId = await captureQuote(
      app,
      placement.accessToken,
      rfqId,
      insurerIds[0],
      '400000.000',
      '10',
    );

    // Draft with NO threshold configured — snapshot says no approval needed.
    const drafted = await request(app.getHttpServer())
      .post('/recommendations')
      .set(bearer(placement.accessToken))
      .send({
        opportunityId,
        recommendedQuotationId: quotationId,
        rationale: 'A long enough written summary to pass the length check.',
        rationaleFactors: FACTORS,
      })
      .expect(201);
    const rec = drafted.body as RecommendationBody;
    expect(rec.approvalRequired).toBe(false);
    expect(rec.blockedFromSend).toHaveLength(0);

    // A Manager now sets the bar below the recommended premium.
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}/target-premium-threshold`)
      .set(bearer(manager.accessToken))
      .send({ targetPremiumThreshold: '250000.000' })
      .expect(200);

    // The send is now blocked even though the stored snapshot still says false.
    await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/send`)
      .set(bearer(placement.accessToken))
      .expect(422);
    const reread = await request(app.getHttpServer())
      .get(`/recommendations/${rec.id}`)
      .set(bearer(placement.accessToken))
      .expect(200);
    expect((reread.body as RecommendationBody).approvalRequired).toBe(true);
    expect((reread.body as RecommendationBody).blockedFromSend).toHaveLength(1);

    // Manager approves; send now succeeds.
    await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/approve`)
      .set(bearer(manager.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/recommendations/${rec.id}/send`)
      .set(bearer(placement.accessToken))
      .expect(201);
  });
});
