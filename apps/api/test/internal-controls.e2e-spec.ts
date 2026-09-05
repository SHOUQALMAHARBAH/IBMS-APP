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
}
interface AuditReportBody {
  generatedAt: string;
  pairsScanned: number;
  totalRowsChecked: number;
  violations: Array<{
    entityType: string;
    pairLabel: string;
    entityId: string;
    makerField: string;
    checkerField: string;
    userId: string;
    dbCheckConstraint: string | null;
  }>;
  byPair: Array<{
    entityType: string;
    pairLabel: string;
    rowsChecked: number;
    violationCount: number;
    dbCheckConstraint: string | null;
    dormant: boolean;
    truncated: boolean;
  }>;
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
    .send({ fullName: 'Internal Controls E2E User', email, password: PASSWORD })
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

/** A minimal Opportunity ready for a Quotation, built directly via Prisma —
 * the policy.e2e-spec.ts `buildOpportunity` shape. */
async function buildOpportunity(
  ownerUserId: string,
  tag: string,
): Promise<{ opportunityId: string; rfqId: string; insurerId: string }> {
  const rand = Math.random().toString(36).slice(2, 8);
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `Internal Controls E2E ${tag} ${rand}`,
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
    data: { name: `Internal Controls E2E ${tag} ins ${rand}` },
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

/** Places a policy with `placerToken`, then issues it with a DIFFERENT
 * officer's `issuerToken` — deliberately, so `issuedByUserId !==
 * placedByUserId` and the eventual planted violation below (checker ==
 * issuer) does not also collide with the DB CHECK that already guards
 * checker vs placer. */
async function issuedPolicyWithDistinctIssuer(
  app: INestApplication<App>,
  placerToken: string,
  placerUserId: string,
  issuerToken: string,
  tag: string,
): Promise<string> {
  const { opportunityId, rfqId, insurerId } = await buildOpportunity(
    placerUserId,
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
    .send({ opportunityId, inceptionDate: '2026-10-01' })
    .expect(201);
  const policyId = (placed.body as PolicyBody).id;
  const policyNumber = `POL-IC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/issuance`)
    .set(bearer(issuerToken))
    .send({
      policyNumber,
      issuedPremium: '120000.000',
      schedule: ISSUED_SCHEDULE,
      documents: [],
    })
    .expect(201);
  return policyId;
}

describe('Internal Controls — self-approval audit (e2e) — backlog Part C #56', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the report behind internal-controls.audit and returns the full 16-pair registry shape', async () => {
    const app = await boot();
    const auditor = await makeUser(app, 'ic-auditor', 'EXTERNAL_AUDITOR');
    const outsider = await makeUser(
      app,
      'ic-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await request(app.getHttpServer())
      .get('/internal-controls/self-approval-audit')
      .set(bearer(outsider.accessToken))
      .expect(403);

    const res = await request(app.getHttpServer())
      .get('/internal-controls/self-approval-audit')
      .set(bearer(auditor.accessToken))
      .expect(200);
    const body = res.body as AuditReportBody;

    // 15 same-table registry pairs + the one cross-table
    // PolicyChecking/Policy pair this process's own build discovered.
    expect(body.pairsScanned).toBe(16);
    expect(body.byPair).toHaveLength(16);
    expect(typeof body.generatedAt).toBe('string');
    expect(
      body.byPair.some(
        (p) => p.entityType === 'DisposalBatch' && p.dormant === true,
      ),
    ).toBe(true);
    expect(
      body.byPair.some(
        (p) =>
          p.entityType === 'PolicyChecking' &&
          p.pairLabel.includes('issuedByUserId') &&
          p.dbCheckConstraint === null,
      ),
    ).toBe(true);
  });

  it('detects a self-approval planted directly in Postgres, bypassing assertDifferentActors — the one pair no DB CHECK can express', async () => {
    const app = await boot();
    const placer = await makeUser(
      app,
      'ic-placer',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const issuer = await makeUser(
      app,
      'ic-issuer',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    const checker = await makeUser(
      app,
      'ic-checker',
      'POLICY_CHECKING_OFFICER',
    );
    const compliance = await makeUser(
      app,
      'ic-compliance',
      'COMPLIANCE_OFFICER',
    );

    const policyId = await issuedPolicyWithDistinctIssuer(
      app,
      placer.accessToken,
      placer.userId,
      issuer.accessToken,
      'plant',
    );

    // A legitimate check — checkedByUserId = checker, distinct from both
    // placer and issuer. This passes assertDifferentActors AND the
    // PolicyChecking_maker_checker_distinct CHECK.
    await request(app.getHttpServer())
      .post(`/policies/${policyId}/checking`)
      .set(bearer(checker.accessToken))
      .send({ requestedCoverage: ISSUED_SCHEDULE })
      .expect(201);
    const policyCheckingId = (
      await prisma.policyChecking.findUniqueOrThrow({ where: { policyId } })
    ).id;

    // Plant the violation directly via Prisma — no service call, no
    // assertDifferentActors — the same "a bug or raw SQL still reaches the
    // table" scenario the DB CHECK constraints defend the OTHER 15 pairs
    // against. checkedByUserId <> placedByUserId still holds (issuer !==
    // placer), so Postgres accepts this write; only the cross-table
    // comparison against Policy.issuedByUserId would have caught it, which
    // is exactly the gap this scan exists to cover.
    await prisma.policyChecking.update({
      where: { policyId },
      data: { checkedByUserId: issuer.userId },
    });

    let restored = false;
    try {
      const res = await request(app.getHttpServer())
        .get('/internal-controls/self-approval-audit')
        .set(bearer(compliance.accessToken))
        .expect(200);
      const body = res.body as AuditReportBody;

      const found = body.violations.find(
        (v) =>
          v.entityType === 'PolicyChecking' && v.entityId === policyCheckingId,
      );
      expect(found).toBeTruthy();
      expect(found?.userId).toBe(issuer.userId);
      expect(found?.dbCheckConstraint).toBeNull();

      const pairRow = body.byPair.find(
        (p) =>
          p.entityType === 'PolicyChecking' &&
          p.pairLabel.includes('issuedByUserId'),
      );
      expect(pairRow?.violationCount).toBeGreaterThanOrEqual(1);

      // one CREATE InternalControlsViolation audit row was written for it
      const violationAudit = await prisma.auditLogEntry.findFirst({
        where: {
          entityType: 'InternalControlsViolation',
          entityId: `PolicyChecking:${policyCheckingId}`,
        },
        orderBy: { occurredAt: 'desc' },
      });
      expect(violationAudit).toBeTruthy();
      expect(violationAudit?.action).toBe('CREATE');
    } finally {
      // Restore a clean state so this deliberately-planted row doesn't
      // linger as a false positive for any later run against this same
      // (cumulative) db-test database — the #51 BrokerLicense-singleton
      // restore-before-finishing precedent, scaled down to one row.
      await prisma.policyChecking
        .update({
          where: { policyId },
          data: { checkedByUserId: checker.userId },
        })
        .then(() => {
          restored = true;
        });
    }
    expect(restored).toBe(true);
  });
});
