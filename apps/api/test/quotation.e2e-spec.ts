import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
interface NegotiationRoundBody {
  round: number;
  versionNumber: number;
  premium: string;
  premiumDeltaFromPrevious: string | null;
  changedTermFields: string[];
  negotiationNotes: string | null;
}
interface ChainBody {
  rfqId: string;
  insurerId: string;
  current: {
    id: string;
    versionNumber: number;
    negotiationNotes: string | null;
  };
  versions: { id: string; versionNumber: number; isCurrentVersion: boolean }[];
  history: NegotiationRoundBody[];
}

async function makeUser(
  app: INestApplication<App>,
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Quotation E2E User', email, password: PASSWORD })
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

/**
 * Backlog Part C #15 — Negotiation. The headline guarantee ("every
 * negotiation round is a new version — never deleted or replaced") is
 * enforced by a DB trigger (migration 20260901180000), which a unit test
 * cannot exercise. This spec drives the real `revise` path against real
 * Postgres and then attacks the frozen history directly.
 *
 * The parent graph (Customer -> RiskProfile -> InsuranceProgram ->
 * Opportunity -> RFQ -> RFQInsurer) is built via Prisma rather than the full
 * HTTP onboarding chain — only `POST /quotations` and
 * `POST /quotations/:id/revise` are under test here.
 */
describe('Quotation negotiation & immutability (e2e) — backlog Part C #15', () => {
  let app: INestApplication<App>;
  let placementToken: string;
  let placementUserId: string;
  let rfqId: string;
  let insurerId: string;
  const suffix = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    app = await createTestApp();
    const placement = await makeUser(
      app,
      'quote-neg-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    placementToken = placement.accessToken;
    placementUserId = placement.userId;

    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: `Negotiation Test Co ${suffix}`,
        ownerUserId: placementUserId,
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
        status: 'RFQ_ISSUED',
      },
    });
    const rfq = await prisma.rFQ.create({
      data: {
        opportunityId: opportunity.id,
        insuranceLine: 'Property All Risks',
      },
    });
    const insurer = await prisma.insurer.create({
      data: { name: `Negotiation Test Insurer ${suffix}` },
    });
    await prisma.rFQInsurer.create({
      data: { rfqId: rfq.id, insurerId: insurer.id, status: 'SENT' },
    });
    rfqId = rfq.id;
    insurerId = insurer.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('captures an opening quote then records negotiation rounds as new immutable versions', async () => {
    const captured = await request(app.getHttpServer())
      .post('/quotations')
      .set(bearer(placementToken))
      .send({ rfqId, insurerId, premium: '125000.000', deductible: '1000.000' })
      .expect(201);
    const v1Chain = captured.body as ChainBody;
    expect(v1Chain.versions).toHaveLength(1);
    expect(v1Chain.current.versionNumber).toBe(1);
    const v1Id = v1Chain.current.id;

    // Round 1 — premium down, flood exclusion removed, with a rationale.
    const round1 = await request(app.getHttpServer())
      .post(`/quotations/${v1Id}/revise`)
      .set(bearer(placementToken))
      .send({
        premium: '119000.000',
        deductible: '1000.000',
        negotiationNotes: 'asked for 5% off and the flood exclusion struck',
      })
      .expect(201);
    const r1Chain = round1.body as ChainBody;
    expect(r1Chain.versions).toHaveLength(2);
    expect(r1Chain.current.versionNumber).toBe(2);
    expect(r1Chain.current.negotiationNotes).toBe(
      'asked for 5% off and the flood exclusion struck',
    );
    const v2Id = r1Chain.current.id;

    // The history projection: round 0 opening quote, round 1 with the delta.
    expect(r1Chain.history.map((r) => r.round)).toEqual([0, 1]);
    expect(r1Chain.history[0].premiumDeltaFromPrevious).toBeNull();
    expect(r1Chain.history[1].premiumDeltaFromPrevious).toBe('-6000.000');
    expect(r1Chain.history[1].changedTermFields).toContain('premium');

    // v1 is retained verbatim, no longer current.
    const v1After = r1Chain.versions.find((v) => v.id === v1Id);
    expect(v1After?.isCurrentVersion).toBe(false);

    // Round 2 — a second revise still succeeds off the current head, even
    // though a superseded predecessor (v1) already exists: the trigger only
    // inspects the row being updated.
    const round2 = await request(app.getHttpServer())
      .post(`/quotations/${v2Id}/revise`)
      .set(bearer(placementToken))
      .send({ premium: '121500.000', deductible: '1000.000' })
      .expect(201);
    const r2Chain = round2.body as ChainBody;
    expect(r2Chain.versions).toHaveLength(3);
    expect(r2Chain.current.versionNumber).toBe(3);
    expect(r2Chain.history.map((r) => r.round)).toEqual([0, 1, 2]);
    expect(r2Chain.history[2].premiumDeltaFromPrevious).toBe('2500.000');
    const v3Id = r2Chain.current.id;

    // --- the immutability guarantee: attack the frozen history directly ---
    await expect(
      prisma.$executeRaw`UPDATE "Quotation" SET "premium" = 1 WHERE id = ${v1Id}`,
    ).rejects.toThrow(/superseded|immutable|Part C #15/i);

    // A flip that also rewrites a term is rejected too (the column-freeze guard).
    await expect(
      prisma.$executeRaw`UPDATE "Quotation" SET "isCurrentVersion" = false, "premium" = 1 WHERE id = ${v3Id}`,
    ).rejects.toThrow(/only change isCurrentVersion|Part C #15/i);

    await expect(
      prisma.$executeRaw`DELETE FROM "Quotation" WHERE id = ${v1Id}`,
    ).rejects.toThrow(/never deleted|Part C #15/i);

    await expect(
      prisma.$executeRaw`DELETE FROM "Quotation" WHERE id = ${v3Id}`,
    ).rejects.toThrow(/never deleted|Part C #15/i);

    // Every version survived, premiums unchanged.
    const rows = await prisma.quotation.findMany({
      where: { rfqId, insurerId },
      orderBy: { versionNumber: 'asc' },
      select: {
        id: true,
        versionNumber: true,
        premium: true,
        isCurrentVersion: true,
      },
    });
    expect(rows.map((r) => r.premium.toFixed(3))).toEqual([
      '125000.000',
      '119000.000',
      '121500.000',
    ]);
    expect(rows.map((r) => r.isCurrentVersion)).toEqual([false, false, true]);
  });

  it('rejects revising a superseded version (422) — the chain only grows from its head', async () => {
    const list = await request(app.getHttpServer())
      .get(`/quotations?rfqId=${rfqId}`)
      .set(bearer(placementToken))
      .expect(200);
    const [chain] = list.body as ChainBody[];
    const supersededId = chain.versions.find((v) => !v.isCurrentVersion)?.id;
    expect(supersededId).toBeDefined();

    await request(app.getHttpServer())
      .post(`/quotations/${supersededId}/revise`)
      .set(bearer(placementToken))
      .send({ premium: '100000.000' })
      .expect(422);
  });
});
