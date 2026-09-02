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
  }[];
}
interface ClaimBody {
  id: string;
  policyId: string;
  status: string;
  estimatedLoss: string;
  isThirdPartyInvolved: boolean;
  isLargeClaim: boolean;
  classification: string;
  thirdParty: {
    fullName: string | null;
    subrogationRecoveryFlag: boolean;
  } | null;
  coverage: {
    scheduleId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  } | null;
  coverageResolvedAtLossDate: boolean;
  statusHistory: {
    fromStatus: string | null;
    toStatus: string;
    changedByUserId: string;
  }[];
}

const ISSUED_SCHEDULE = {
  limits: { buildings: '5000000.000' },
  sumsInsured: { total: '5000000.000' },
  namedPerils: ['fire', 'flood'],
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
    .send({ fullName: 'Claim E2E User', email, password: PASSWORD })
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

/** Place + issue a policy (a coverage schedule now exists) with an explicit
 * period — enough for a Process 23 claim notification. */
async function issuedPolicy(
  app: INestApplication<App>,
  placerToken: string,
  ownerUserId: string,
  tag: string,
  period: { inceptionDate: string; expiryDate: string },
): Promise<{ policyId: string; scheduleId: string }> {
  const rand = Math.random().toString(36).slice(2, 8);
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `Claim E2E ${tag} ${rand}`,
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
    data: { name: `Claim E2E ${tag} ins ${rand}` },
  });
  await prisma.rFQInsurer.create({
    data: { rfqId: rfq.id, insurerId: insurer.id, status: 'SENT' },
  });

  const quote = await request(app.getHttpServer())
    .post('/quotations')
    .set(bearer(placerToken))
    .send({
      rfqId: rfq.id,
      insurerId: insurer.id,
      premium: '120000.000',
      commissionRatePercent: '12',
    })
    .expect(201);
  const drafted = await request(app.getHttpServer())
    .post('/recommendations')
    .set(bearer(placerToken))
    .send({
      opportunityId: opportunity.id,
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
      opportunityId: opportunity.id,
      decision: 'ACCEPT',
      evidenceType: 'e-signature',
      evidenceRef: `env-${tag}`,
    })
    .expect(201);

  const placed = await request(app.getHttpServer())
    .post('/policies')
    .set(bearer(placerToken))
    .send({ opportunityId: opportunity.id, ...period })
    .expect(201);
  const policyId = (placed.body as PolicyBody).id;
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/issuance`)
    .set(bearer(placerToken))
    .send({
      policyNumber: `POL-CLM-${Date.now()}-${rand}`,
      issuedPremium: '120000.000',
      schedule: { ...ISSUED_SCHEDULE, effectiveFrom: period.inceptionDate },
      documents: [],
    })
    .expect(201);

  const policy = await request(app.getHttpServer())
    .get(`/policies/${policyId}`)
    .set(bearer(placerToken))
    .expect(200);
  const scheduleId = (policy.body as PolicyBody).schedules[0].id;
  return { policyId, scheduleId };
}

describe('Claim Notification (e2e) — backlog Part C #23', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('notifies a claim at NOTIFIED and resolves the coverage version in force on the loss date — not the current one', async () => {
    const app = await boot();
    const plc = await makeUser(app, 'clm-plc', 'PLACEMENT_TECHNICAL_OFFICER');
    // a pure Claims Officer — no PLACEMENT role. Notifies + reads via
    // claim.notify / claim.read and the policy.read grant added at #23.
    const clm = await makeUser(app, 'clm-officer', 'CLAIMS_OFFICER');

    const { policyId, scheduleId } = await issuedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'resolve',
      { inceptionDate: '2026-01-01', expiryDate: '2027-01-01' },
    );

    // Simulate a mid-term endorsement: close v1 at 2026-06-01, open v2.
    const boundary = new Date('2026-06-01T00:00:00.000Z');
    await prisma.policySchedule.update({
      where: { id: scheduleId },
      data: { effectiveTo: boundary },
    });
    const v2 = await prisma.policySchedule.create({
      data: {
        policyId,
        effectiveFrom: boundary,
        limits: { buildings: '6000000.000' },
        sumsInsured: { total: '6000000.000' },
        namedPerils: ['fire', 'flood'],
        extensions: ['debris removal'],
      },
    });

    // Loss BEFORE the endorsement -> resolves to the (now closed) v1.
    const beforeRes = await request(app.getHttpServer())
      .post('/claims')
      .set(bearer(clm.accessToken))
      .send({
        policyId,
        lossDate: '2026-03-15',
        causeOfLoss: 'Storm damage to the warehouse roof.',
        lossLocation: 'Unit 4, Sahab Industrial Estate',
        estimatedLoss: '18000.000',
      })
      .expect(201);
    const before = beforeRes.body as ClaimBody;
    expect(before.status).toBe('NOTIFIED');
    expect(before.classification).toBe('HIGHLY_CONFIDENTIAL');
    expect(before.isLargeClaim).toBe(false);
    expect(before.coverage?.scheduleId).toBe(scheduleId);
    expect(before.coverageResolvedAtLossDate).toBe(true);
    expect(before.statusHistory).toHaveLength(1);
    expect(before.statusHistory[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'NOTIFIED',
      changedByUserId: clm.userId,
    });

    // Loss AFTER the endorsement -> resolves to v2.
    const afterRes = await request(app.getHttpServer())
      .post('/claims')
      .set(bearer(clm.accessToken))
      .send({
        policyId,
        lossDate: '2026-08-01',
        causeOfLoss: 'Fire in the packing hall.',
        estimatedLoss: '30000.000',
      })
      .expect(201);
    const after = afterRes.body as ClaimBody;
    expect(after.coverage?.scheduleId).toBe(v2.id);
    expect(after.isLargeClaim).toBe(true); // >= 25000 drafted threshold

    // no direct .status writes — the claim was created at @default(NOTIFIED)
    const notifiedHistory = await prisma.claimStatusHistory.count({
      where: { claimId: before.id },
    });
    expect(notifiedHistory).toBe(1);

    const list = await request(app.getHttpServer())
      .get(`/claims?policyId=${policyId}`)
      .set(bearer(clm.accessToken))
      .expect(200);
    expect((list.body as ClaimBody[]).length).toBe(2);

    // reads of a HIGHLY_CONFIDENTIAL Claim are audited as sensitive-data
    // access (Part 10.3 / sensitive-data-handling.md) — one for the list, one
    // for a subsequent GET /:id.
    await request(app.getHttpServer())
      .get(`/claims/${before.id}`)
      .set(bearer(clm.accessToken))
      .expect(200);
    const sensitiveReads = await prisma.auditLogEntry.findMany({
      where: {
        action: 'READ',
        entityType: { in: ['Claim', 'Policy'] },
        isSensitiveDataAccess: true,
        userId: clm.userId,
      },
    });
    expect(sensitiveReads.length).toBeGreaterThanOrEqual(2);
    // never the claim narrative
    expect(JSON.stringify(sensitiveReads)).not.toContain('warehouse roof');
  });

  it('rejects a loss outside the coverage period', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'clm-outside',
      'PLACEMENT_TECHNICAL_OFFICER',
      'CLAIMS_OFFICER',
    );
    const { policyId } = await issuedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'outside',
      { inceptionDate: '2026-02-01', expiryDate: '2026-08-01' },
    );

    // before inception
    await request(app.getHttpServer())
      .post('/claims')
      .set(bearer(plc.accessToken))
      .send({
        policyId,
        lossDate: '2026-01-15',
        causeOfLoss: 'Loss predating cover.',
        estimatedLoss: '5000.000',
      })
      .expect(422);

    // on/after expiry (open schedule row is still open — the period is the bound)
    await request(app.getHttpServer())
      .post('/claims')
      .set(bearer(plc.accessToken))
      .send({
        policyId,
        lossDate: '2026-08-15',
        causeOfLoss: 'Loss after cover ended.',
        estimatedLoss: '5000.000',
      })
      .expect(422);
  });

  it('records a third party with encrypted contact details that never reach the response or the audit trail', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'clm-tp',
      'PLACEMENT_TECHNICAL_OFFICER',
      'CLAIMS_OFFICER',
    );
    const { policyId } = await issuedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'tp',
      { inceptionDate: '2026-01-01', expiryDate: '2027-01-01' },
    );

    const secretPhone = '+962 7 9123 4567';
    const res = await request(app.getHttpServer())
      .post('/claims')
      .set(bearer(plc.accessToken))
      .send({
        policyId,
        lossDate: '2026-05-20',
        causeOfLoss:
          'Vehicle collision at the depot gate; third party injured.',
        estimatedLoss: '12000.000',
        isThirdPartyInvolved: true,
        thirdParty: {
          fullName: 'Mr Sami Haddad',
          contactDetails: secretPhone,
          subrogationRecoveryFlag: true,
        },
      })
      .expect(201);
    const claim = res.body as ClaimBody;
    expect(claim.isThirdPartyInvolved).toBe(true);
    expect(claim.thirdParty?.fullName).toBe('Mr Sami Haddad');
    expect(claim.thirdParty?.subrogationRecoveryFlag).toBe(true);
    expect(JSON.stringify(claim)).not.toContain(secretPhone);
    expect(JSON.stringify(claim)).not.toContain('9123 4567');

    const tp = await prisma.thirdPartyClaimant.findUniqueOrThrow({
      where: { claimId: claim.id },
    });
    expect(tp.contactDetailsEnc).toBeTruthy();
    expect(tp.contactDetailsEnc).not.toContain(secretPhone);
    // ciphertext shape: keyId:iv:authTag:ciphertext
    expect(tp.contactDetailsEnc?.split(':').length).toBe(4);

    const auditRows = await prisma.auditLogEntry.findMany({
      where: {
        OR: [
          { entityType: 'Claim', entityId: claim.id },
          { entityType: 'ThirdPartyClaimant', entityId: tp.id },
        ],
      },
    });
    expect(JSON.stringify(auditRows)).not.toContain(secretPhone);
    expect(JSON.stringify(auditRows)).not.toContain('Sami Haddad');
    // the field-level-encryption key use was logged
    const keyUse = await prisma.auditLogEntry.count({
      where: {
        entityType: 'ThirdPartyClaimant',
        entityId: tp.id,
        action: 'ENCRYPTION_KEY_USED',
      },
    });
    expect(keyUse).toBe(1);
  });

  it('is forbidden without claim.notify', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'clm-plc-only',
      'PLACEMENT_TECHNICAL_OFFICER',
      'CLAIMS_OFFICER',
    );
    // Compliance holds neither claim.notify nor claim.read.
    const comp = await makeUser(app, 'clm-comp', 'COMPLIANCE_OFFICER');
    const { policyId } = await issuedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'rbac',
      { inceptionDate: '2026-01-01', expiryDate: '2027-01-01' },
    );

    await request(app.getHttpServer())
      .post('/claims')
      .set(bearer(comp.accessToken))
      .send({
        policyId,
        lossDate: '2026-05-20',
        causeOfLoss: 'Attempted by an unauthorised role.',
        estimatedLoss: '1000.000',
      })
      .expect(403);
  });
});
