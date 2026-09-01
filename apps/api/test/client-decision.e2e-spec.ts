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
interface ClientDecisionBody {
  id: string;
  decision: string;
  route: string;
  routeLabel: string;
  routingComplete: boolean;
  opportunityStatus: string;
}

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
    .send({ fullName: 'Client Decision E2E User', email, password: PASSWORD })
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

/** A COMPARISON_BUILT Opportunity with one RFQ + one shortlisted insurer,
 * owned by `ownerUserId`. */
async function buildOpportunity(
  ownerUserId: string,
  tag: string,
): Promise<{ opportunityId: string; rfqId: string; insurerId: string }> {
  const rand = Math.random().toString(36).slice(2, 8);
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `CD E2E ${tag} ${rand}`,
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
    data: { name: `CD E2E ${tag} ins ${rand}` },
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

/** Drive an Opportunity all the way to SENT_TO_CLIENT: capture a single
 * quote (no threshold, one quote -> no approval / COI gates), draft the
 * recommendation, send it. */
async function opportunityWithSentRecommendation(
  app: INestApplication<App>,
  placementToken: string,
  ownerUserId: string,
  tag: string,
): Promise<string> {
  const { opportunityId, rfqId, insurerId } = await buildOpportunity(
    ownerUserId,
    tag,
  );
  const quote = await request(app.getHttpServer())
    .post('/quotations')
    .set(bearer(placementToken))
    .send({
      rfqId,
      insurerId,
      premium: '120000.000',
      commissionRatePercent: '12',
    })
    .expect(201);
  const drafted = await request(app.getHttpServer())
    .post('/recommendations')
    .set(bearer(placementToken))
    .send({
      opportunityId,
      recommendedQuotationId: (quote.body as QuotationChainBody).current.id,
      rationale: 'A long enough written summary to pass the length check.',
      rationaleFactors: FACTORS,
    })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/recommendations/${(drafted.body as { id: string }).id}/send`)
    .set(bearer(placementToken))
    .expect(201);
  return opportunityId;
}

async function opportunityStatus(
  app: INestApplication<App>,
  token: string,
  opportunityId: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/opportunities/${opportunityId}`)
    .set(bearer(token))
    .expect(200);
  return (res.body as { status: string }).status;
}

describe('Client Decision Handling (e2e) — backlog Part C #17', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('routes the six decision types down three paths and blocks a second decision', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'cd-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // ACCEPT -> placement
    const accepted = await opportunityWithSentRecommendation(
      app,
      placement.accessToken,
      placement.userId,
      'accept',
    );
    const acceptRes = await request(app.getHttpServer())
      .post('/client-decisions')
      .set(bearer(placement.accessToken))
      .send({
        opportunityId: accepted,
        decision: 'ACCEPT',
        evidenceType: 'e-signature',
        evidenceRef: 'env-accept-1',
      })
      .expect(201);
    const acceptBody = acceptRes.body as ClientDecisionBody;
    expect(acceptBody.route).toBe('PLACEMENT');
    expect(acceptBody.routeLabel).toBe('Proceed to placement');
    expect(acceptBody.routingComplete).toBe(true);
    expect(await opportunityStatus(app, placement.accessToken, accepted)).toBe(
      'PLACEMENT',
    );

    // a second decision on the same Opportunity is a 409
    await request(app.getHttpServer())
      .post('/client-decisions')
      .set(bearer(placement.accessToken))
      .send({
        opportunityId: accepted,
        decision: 'REJECT',
        evidenceType: 'email_confirmation',
        evidenceRef: 'msg-2',
      })
      .expect(409);

    // REJECT -> close the request
    const rejected = await opportunityWithSentRecommendation(
      app,
      placement.accessToken,
      placement.userId,
      'reject',
    );
    await request(app.getHttpServer())
      .post('/client-decisions')
      .set(bearer(placement.accessToken))
      .send({
        opportunityId: rejected,
        decision: 'REJECT',
        evidenceType: 'email_confirmation',
        evidenceRef: 'msg-reject-1',
      })
      .expect(201);
    expect(await opportunityStatus(app, placement.accessToken, rejected)).toBe(
      'CLOSED_LOST',
    );

    // REQUEST_PRICE_REDUCTION -> renewed negotiation
    const renegotiated = await opportunityWithSentRecommendation(
      app,
      placement.accessToken,
      placement.userId,
      'reneg',
    );
    const renegRes = await request(app.getHttpServer())
      .post('/client-decisions')
      .set(bearer(placement.accessToken))
      .send({
        opportunityId: renegotiated,
        decision: 'REQUEST_PRICE_REDUCTION',
        evidenceType: 'email_confirmation',
        evidenceRef: 'msg-reneg-1',
        notes: 'Client wants ~8% off before committing.',
      })
      .expect(201);
    expect((renegRes.body as ClientDecisionBody).route).toBe('RENEGOTIATE');
    expect(
      await opportunityStatus(app, placement.accessToken, renegotiated),
    ).toBe('RENEGOTIATE');

    // GET reflects the recorded decision
    const list = await request(app.getHttpServer())
      .get(`/client-decisions?opportunityId=${renegotiated}`)
      .set(bearer(placement.accessToken))
      .expect(200);
    expect((list.body as ClientDecisionBody[])[0].decision).toBe(
      'REQUEST_PRICE_REDUCTION',
    );
  });

  it('422s a decision on an Opportunity with no sent recommendation, and a validation error on a bad decision type', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'cd-plc2',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // A COMPARISON_BUILT Opportunity with no recommendation at all.
    const { opportunityId } = await buildOpportunity(placement.userId, 'norec');
    await request(app.getHttpServer())
      .post('/client-decisions')
      .set(bearer(placement.accessToken))
      .send({
        opportunityId,
        decision: 'ACCEPT',
        evidenceType: 'e-signature',
        evidenceRef: 'env-x',
      })
      .expect(422);

    // On an Opportunity that DOES have a sent recommendation, a bad decision
    // type / evidence type is a 400 (DTO validation). (The "drafted but not
    // sent -> 422" path is unit-covered.)
    const sent = await opportunityWithSentRecommendation(
      app,
      placement.accessToken,
      placement.userId,
      'badtype',
    );
    await request(app.getHttpServer())
      .post('/client-decisions')
      .set(bearer(placement.accessToken))
      .send({
        opportunityId: sent,
        decision: 'MAYBE',
        evidenceType: 'e-signature',
        evidenceRef: 'env-x',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/client-decisions')
      .set(bearer(placement.accessToken))
      .send({
        opportunityId: sent,
        decision: 'ACCEPT',
        evidenceType: 'carrier-pigeon',
        evidenceRef: 'env-x',
      })
      .expect(400);
  });
});
