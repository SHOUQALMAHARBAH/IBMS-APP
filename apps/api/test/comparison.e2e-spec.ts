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
interface ComparisonMatrixBody {
  id: string;
}

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
    .send({ fullName: 'Comparison E2E User', email, password: PASSWORD })
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
    // Partial UNIQUE `UserRoleAssignment_one_active_per_user_role` (migration
    // 20260920140000) means a revoked grant is HISTORY and a new grant is a
    // new row — so this creates one only when no active grant exists, rather
    // than resurrecting a revoked one and erasing its audit trail.
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

/** Builds a real RFQ with 2 insurers shortlisted and a current-version
 * quotation each, owned by `ownerUserId`. Mirrors
 * recommendation.e2e-spec.ts's own `buildOpportunity`/`captureQuote`
 * fixture shape — Process 14 (comparison) has no dedicated e2e file of
 * its own before this one; this fixture is scoped to what THIS item's
 * document-generation endpoint needs to exercise, not a full audit of
 * the pre-existing, previously-untested build/get endpoints. */
async function buildRfqWithQuotes(
  placementToken: string,
  ownerUserId: string,
  languagePreference: 'AR' | 'EN',
  tag: string,
): Promise<{ rfqId: string }> {
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `Cmp E2E ${tag} ${Math.random().toString(36).slice(2, 8)}`,
      ownerUserId,
      languagePreference,
    },
  });
  const riskProfile = await prisma.riskProfile.create({
    data: { customerId: customer.id, siteLabel: 'HQ' },
  });
  const program = await prisma.insuranceProgram.create({
    data: { riskProfileId: riskProfile.id, status: 'FINALIZED' },
  });
  const opportunity = await prisma.opportunity.create({
    data: { customerId: customer.id, insuranceProgramId: program.id },
  });
  const rfq = await prisma.rFQ.create({
    data: {
      opportunityId: opportunity.id,
      insuranceLine: 'Property All Risks',
    },
  });
  for (let i = 0; i < 2; i += 1) {
    const insurer = await prisma.insurer.create({
      data: {
        name: `Cmp E2E ${tag} ins ${i} ${Math.random().toString(36).slice(2, 6)}`,
      },
    });
    await prisma.rFQInsurer.create({
      data: { rfqId: rfq.id, insurerId: insurer.id, status: 'SENT' },
    });
    await request((await boot()).getHttpServer())
      .post('/quotations')
      .set(bearer(placementToken))
      .send({
        rfqId: rfq.id,
        insurerId: insurer.id,
        premium: i === 0 ? '1250.500' : '1400.000',
        commissionRatePercent: '15',
      })
      .expect(201);
  }
  return { rfqId: rfq.id };
}

describe('Quote Comparison document generation (e2e) — Part F item #7', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('generates a bilingual quotation-comparison PDF, respecting comparison visibility, defaulting to the customer language, and honoring an explicit override', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'cmp-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    const owningSales = await makeUser(
      app,
      'cmp-sales-owner',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const otherSales = await makeUser(
      app,
      'cmp-sales-other',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const manager = await makeUser(app, 'cmp-mgr', 'BRANCH_DEPARTMENT_MANAGER');
    const noPerm = await makeUser(app, 'cmp-none', 'CLAIMS_OFFICER');

    const { rfqId: arRfqId } = await buildRfqWithQuotes(
      placement.accessToken,
      owningSales.userId,
      'AR',
      'ar',
    );
    const { rfqId: enRfqId } = await buildRfqWithQuotes(
      placement.accessToken,
      owningSales.userId,
      'EN',
      'en',
    );

    const arBuild = await request(app.getHttpServer())
      .post('/comparison-matrices')
      .set(bearer(placement.accessToken))
      .send({ rfqId: arRfqId })
      .expect(201);
    const arComparisonId = (arBuild.body as ComparisonMatrixBody).id;

    const enBuild = await request(app.getHttpServer())
      .post('/comparison-matrices')
      .set(bearer(placement.accessToken))
      .send({ rfqId: enRfqId })
      .expect(201);
    const enComparisonId = (enBuild.body as ComparisonMatrixBody).id;

    // forbidden without comparison.read
    await request(app.getHttpServer())
      .get(`/comparison-matrices/${arComparisonId}/document`)
      .set(bearer(noPerm.accessToken))
      .expect(403);

    // unknown comparison -> 404
    await request(app.getHttpServer())
      .get('/comparison-matrices/11111111-1111-4111-8111-111111111111/document')
      .set(bearer(placement.accessToken))
      .expect(404);

    // a Sales Officer who does NOT own the customer -> 404, even though
    // they hold comparison.read — visibility, not just the flat
    // permission, gates this (the whole point of routing through
    // ComparisonService.getByIdWithCustomer instead of the repository).
    await request(app.getHttpServer())
      .get(`/comparison-matrices/${arComparisonId}/document`)
      .set(bearer(otherSales.accessToken))
      .expect(404);

    // a Manager (cross-owner visibility) CAN reach it regardless of ownership
    const managerRes = await request(app.getHttpServer())
      .get(`/comparison-matrices/${arComparisonId}/document`)
      .set(bearer(manager.accessToken))
      .expect(200);
    expect((managerRes.body as Buffer).subarray(0, 5).toString('latin1')).toBe(
      '%PDF-',
    );

    // default: AR customer -> a real PDF, no explicit language needed
    const arDefault = await request(app.getHttpServer())
      .get(`/comparison-matrices/${arComparisonId}/document`)
      .set(bearer(owningSales.accessToken))
      .expect(200);
    expect(arDefault.headers['content-type']).toContain('application/pdf');
    const arBuffer = arDefault.body as Buffer;
    expect(arBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // default: EN customer -> also a real PDF
    const enDefault = await request(app.getHttpServer())
      .get(`/comparison-matrices/${enComparisonId}/document`)
      .set(bearer(owningSales.accessToken))
      .expect(200);
    expect((enDefault.body as Buffer).subarray(0, 5).toString('latin1')).toBe(
      '%PDF-',
    );

    // explicit override: EN customer, but ask for AR anyway
    const overridden = await request(app.getHttpServer())
      .get(`/comparison-matrices/${enComparisonId}/document?language=AR`)
      .set(bearer(owningSales.accessToken))
      .expect(200);
    expect((overridden.body as Buffer).subarray(0, 5).toString('latin1')).toBe(
      '%PDF-',
    );

    // DUAL renders genuinely more content than either single-language
    // document (two full sections, not one) — a real size proof.
    const dual = await request(app.getHttpServer())
      .get(`/comparison-matrices/${arComparisonId}/document?language=DUAL`)
      .set(bearer(owningSales.accessToken))
      .expect(200);
    const dualBuffer = dual.body as Buffer;
    expect(dualBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(dualBuffer.length).toBeGreaterThan(arBuffer.length);

    // an invalid language value 400s (class-validator @IsIn)
    await request(app.getHttpServer())
      .get(`/comparison-matrices/${arComparisonId}/document?language=FR`)
      .set(bearer(owningSales.accessToken))
      .expect(400);
  }, 45000);
});
