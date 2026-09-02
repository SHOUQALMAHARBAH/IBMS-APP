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
  claimNumber: string | null;
  insurerClaimReference: string | null;
  adjuster: {
    name: string;
    firm: string | null;
    assignedAt: string;
    surveyCompletedAt: string | null;
    investigationCompletedAt: string | null;
  } | null;
  documents: {
    id: string;
    docType: string;
    category: string;
    classification: string;
    fileName: string;
    versionNumber: number;
    uploadedByUserId: string;
  }[];
  documentChecklist: { docType: string; required: boolean; present: boolean }[];
  documentationComplete: boolean;
  missingMandatoryDocuments: string[];
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

describe('Claim Notification + Registration + Documentation (e2e) — backlog Part C #23-25', () => {
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

  it('#24 — registers a NOTIFIED claim with the insurer and assigns the loss adjuster (NOTIFIED -> REGISTERED via the engine)', async () => {
    const app = await boot();
    const plc = await makeUser(app, 'clm24-plc', 'PLACEMENT_TECHNICAL_OFFICER');
    const clm = await makeUser(app, 'clm24-officer', 'CLAIMS_OFFICER');
    // Sales holds claim.notify but NOT claim.register.
    const sales = await makeUser(
      app,
      'clm24-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );

    const { policyId } = await issuedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'reg',
      {
        inceptionDate: '2026-01-01',
        expiryDate: '2027-01-01',
      },
    );
    // the db-test DB is cumulative — any @unique value must be fresh per run
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const insurerRef = `INS-CLM-${tag}`;
    const brokerNumber = `BRK-${tag}`;

    const notified = await request(app.getHttpServer())
      .post('/claims')
      .set(bearer(clm.accessToken))
      .send({
        policyId,
        lossDate: '2026-04-02',
        causeOfLoss: 'Water ingress after a burst riser main.',
        estimatedLoss: '14500.000',
      })
      .expect(201);
    const claimId = (notified.body as ClaimBody).id;

    // Sales cannot register.
    await request(app.getHttpServer())
      .post(`/claims/${claimId}/registration`)
      .set(bearer(sales.accessToken))
      .send({
        insurerClaimReference: insurerRef,
        adjuster: { name: 'Cunningham Lindsey' },
      })
      .expect(403);

    const registered = await request(app.getHttpServer())
      .post(`/claims/${claimId}/registration`)
      .set(bearer(clm.accessToken))
      .send({
        insurerClaimReference: insurerRef,
        claimNumber: brokerNumber,
        adjuster: { name: 'Cunningham Lindsey', firm: 'CL Loss Adjusters' },
      })
      .expect(201);
    const rBody = registered.body as ClaimBody;
    expect(rBody.status).toBe('REGISTERED');
    expect(rBody.insurerClaimReference).toBe(insurerRef);
    expect(rBody.claimNumber).toBe(brokerNumber);
    expect(rBody.adjuster).toMatchObject({
      name: 'Cunningham Lindsey',
      firm: 'CL Loss Adjusters',
    });
    expect(rBody.statusHistory.map((h) => h.toStatus)).toEqual([
      'NOTIFIED',
      'REGISTERED',
    ]);
    expect(rBody.statusHistory[1].changedByUserId).toBe(clm.userId);

    // exactly one engine TRANSITION row for the claim (a direct .status = write
    // anywhere would drop it)
    const transitions = await prisma.auditLogEntry.count({
      where: { entityType: 'Claim', entityId: claimId, action: 'TRANSITION' },
    });
    expect(transitions).toBe(1);

    // a byte-identical re-call (network retry) is an idempotent no-op 201
    const again = await request(app.getHttpServer())
      .post(`/claims/${claimId}/registration`)
      .set(bearer(clm.accessToken))
      .send({
        insurerClaimReference: insurerRef,
        claimNumber: brokerNumber,
        adjuster: { name: 'Cunningham Lindsey', firm: 'CL Loss Adjusters' },
      })
      .expect(201);
    expect((again.body as ClaimBody).status).toBe('REGISTERED');

    // any change to the registration detail — here just the adjuster firm — is
    // a 409, never a silently-discarded no-op
    await request(app.getHttpServer())
      .post(`/claims/${claimId}/registration`)
      .set(bearer(clm.accessToken))
      .send({
        insurerClaimReference: insurerRef,
        claimNumber: brokerNumber,
        adjuster: { name: 'Cunningham Lindsey', firm: 'A Different Firm' },
      })
      .expect(409);

    // and a different adjuster is likewise a 409
    await request(app.getHttpServer())
      .post(`/claims/${claimId}/registration`)
      .set(bearer(clm.accessToken))
      .send({
        insurerClaimReference: insurerRef,
        adjuster: { name: 'Somebody Else' },
      })
      .expect(409);

    // still exactly one TRANSITION row (the re-calls did not re-transition)
    const transitionsAfter = await prisma.auditLogEntry.count({
      where: { entityType: 'Claim', entityId: claimId, action: 'TRANSITION' },
    });
    expect(transitionsAfter).toBe(1);
  });

  it('#25 — files claim documentation, advances to DOCUMENTATION_IN_PROGRESS, and tracks the mandatory checklist', async () => {
    const app = await boot();
    const plc = await makeUser(app, 'clm25-plc', 'PLACEMENT_TECHNICAL_OFFICER');
    const clm = await makeUser(app, 'clm25-officer', 'CLAIMS_OFFICER');

    const { policyId } = await issuedPolicy(
      app,
      plc.accessToken,
      plc.userId,
      'doc',
      {
        inceptionDate: '2026-01-01',
        expiryDate: '2027-01-01',
      },
    );
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const notified = await request(app.getHttpServer())
      .post('/claims')
      .set(bearer(clm.accessToken))
      .send({
        policyId,
        lossDate: '2026-04-02',
        causeOfLoss: 'Storm ripped roofing sheets off the warehouse.',
        estimatedLoss: '18000.000',
      })
      .expect(201);
    const claimId = (notified.body as ClaimBody).id;

    // must register before documenting
    await request(app.getHttpServer())
      .post(`/claims/${claimId}/documents`)
      .set(bearer(clm.accessToken))
      .send({
        documents: [
          {
            docType: 'claim_form',
            classification: 'CONFIDENTIAL',
            fileName: 'f',
            storageRef: 's',
          },
        ],
      })
      .expect(422);

    await request(app.getHttpServer())
      .post(`/claims/${claimId}/registration`)
      .set(bearer(clm.accessToken))
      .send({
        insurerClaimReference: `INS-${tag}`,
        adjuster: { name: 'Cunningham Lindsey' },
      })
      .expect(201);

    // a Placement officer holds no claim.document
    await request(app.getHttpServer())
      .post(`/claims/${claimId}/documents`)
      .set(bearer(plc.accessToken))
      .send({
        documents: [
          {
            docType: 'photo',
            classification: 'CONFIDENTIAL',
            fileName: 'p',
            storageRef: 's',
          },
        ],
      })
      .expect(403);

    // a medical_report must be HIGHLY_CONFIDENTIAL
    await request(app.getHttpServer())
      .post(`/claims/${claimId}/documents`)
      .set(bearer(clm.accessToken))
      .send({
        documents: [
          {
            docType: 'medical_report',
            classification: 'CONFIDENTIAL',
            fileName: 'm.pdf',
            storageRef: 's3://x/m',
          },
        ],
      })
      .expect(422);

    // first attach: claim_form + photo (property line still needs repair_estimate).
    // db-test is cumulative — fileNames/refs must be fresh per run.
    const photoName = `roof-damage-${tag}.jpg`;
    const photoRef = `s3://claims/${tag}/photo`;
    const first = await request(app.getHttpServer())
      .post(`/claims/${claimId}/documents`)
      .set(bearer(clm.accessToken))
      .send({
        documents: [
          {
            docType: 'claim_form',
            classification: 'CONFIDENTIAL',
            fileName: `claim-form-${tag}.pdf`,
            storageRef: `s3://claims/${tag}/cf`,
          },
          {
            docType: 'photo',
            classification: 'CONFIDENTIAL',
            fileName: photoName,
            storageRef: photoRef,
          },
        ],
      })
      .expect(201);
    const fBody = first.body as ClaimBody;
    expect(fBody.status).toBe('DOCUMENTATION_IN_PROGRESS');
    expect(fBody.documents.map((d) => d.docType).sort()).toEqual([
      'claim_form',
      'photo',
    ]);
    expect(fBody.documentChecklist).toHaveLength(8);
    expect(fBody.documentationComplete).toBe(false);
    expect(fBody.missingMandatoryDocuments).toEqual(['repair_estimate']);
    expect(fBody.statusHistory.map((h) => h.toStatus)).toEqual([
      'NOTIFIED',
      'REGISTERED',
      'DOCUMENTATION_IN_PROGRESS',
    ]);

    // exactly one NOTIFIED->... plus REGISTERED plus DOCUMENTATION_IN_PROGRESS
    // TRANSITION rows — every status move went through the engine
    const claimTransitions = await prisma.auditLogEntry.count({
      where: { entityType: 'Claim', entityId: claimId, action: 'TRANSITION' },
    });
    expect(claimTransitions).toBe(2); // REGISTERED, DOCUMENTATION_IN_PROGRESS

    // the Document is CLAIM category, NOT linked to a Policy (the ClaimDocument
    // join is the canonical link)
    const linkRows = await prisma.claimDocument.findMany({
      where: { claimId },
      include: { document: true },
    });
    expect(linkRows).toHaveLength(2);
    const photoLink = linkRows.find((l) => l.docType === 'photo');
    expect(photoLink?.document.category).toBe('CLAIM');
    expect(photoLink?.document.policyId).toBeNull();
    expect(photoLink?.document.fileName).toBe(photoName);

    // the audit trail for THIS claim's ClaimDocument rows carries no
    // fileName / storageRef
    const docAudits = await prisma.auditLogEntry.findMany({
      where: {
        entityType: 'ClaimDocument',
        entityId: { in: linkRows.map((l) => l.id) },
      },
    });
    expect(docAudits).toHaveLength(2);
    expect(JSON.stringify(docAudits)).not.toContain(photoName);
    expect(JSON.stringify(docAudits)).not.toContain(photoRef);

    // second attach completes the mandatory checklist
    const second = await request(app.getHttpServer())
      .post(`/claims/${claimId}/documents`)
      .set(bearer(clm.accessToken))
      .send({
        documents: [
          {
            docType: 'repair_estimate',
            classification: 'CONFIDENTIAL',
            fileName: `quote-${tag}.pdf`,
            storageRef: `s3://claims/${tag}/q`,
          },
        ],
      })
      .expect(201);
    const sBody = second.body as ClaimBody;
    expect(sBody.documentationComplete).toBe(true);
    expect(sBody.missingMandatoryDocuments).toEqual([]);
    // a later attach did NOT re-transition
    const claimTransitions2 = await prisma.auditLogEntry.count({
      where: { entityType: 'Claim', entityId: claimId, action: 'TRANSITION' },
    });
    expect(claimTransitions2).toBe(2);
  });
});
