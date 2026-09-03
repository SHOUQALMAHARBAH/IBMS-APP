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
interface AgreementBody {
  id: string;
  insurerId: string;
  insuranceLine: string;
  ratePercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isOpen: boolean;
}
interface EntryBody {
  id: string;
  policyId: string;
  commissionAgreementId: string | null;
  amount: string;
  vatAmount: string;
  overrideAmount: string | null;
  effectiveAmount: string;
  status: string;
  isManualOverride: boolean;
  overrideReason: string | null;
  overrideRequestedByUserId: string | null;
  overrideApprovedByUserId: string | null;
  overridePending: boolean;
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
    .send({ fullName: 'Commission E2E User', email, password: PASSWORD })
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

/** An issued policy: line "Property All Risks", issuedPremium 120000.000,
 * inceptionDate 2026-10-01. Returns its id + insurer id. */
async function issuedPolicy(
  app: INestApplication<App>,
  placerToken: string,
  checkerToken: string,
  ownerUserId: string,
  tag: string,
): Promise<{ policyId: string; insurerId: string }> {
  const rand = Math.random().toString(36).slice(2, 8);
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `Commission E2E ${tag} ${rand}`,
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
    data: { name: `Commission E2E ${tag} ins ${rand}` },
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
      evidenceRef: `com-${tag}`,
    })
    .expect(201);

  const placed = await request(app.getHttpServer())
    .post('/policies')
    .set(bearer(placerToken))
    .send({
      opportunityId: opportunity.id,
      inceptionDate: '2026-10-01',
      expiryDate: '2027-10-01',
    })
    .expect(201);
  const policyId = (placed.body as { id: string }).id;
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/issuance`)
    .set(bearer(placerToken))
    .send({
      policyNumber: `POL-COM-${Date.now()}-${rand}`,
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

  return { policyId, insurerId: insurer.id };
}

describe('Commission Calculation (e2e) — backlog Part C #35', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('applies the governed rate, records one entry per policy, and runs the override maker/checker', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'com-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'com-chk', 'POLICY_CHECKING_OFFICER');
    const fin = await makeUser(app, 'com-fin', 'FINANCE_COLLECTIONS_OFFICER');
    const comp = await makeUser(app, 'com-comp', 'COMPLIANCE_OFFICER');
    const mgr = await makeUser(app, 'com-mgr', 'BRANCH_DEPARTMENT_MANAGER');
    // a dual-hatted user: can raise (Finance) AND approve (Manager) — used to
    // exercise assertDifferentActors, not just the permission guard
    const finMgr = await makeUser(
      app,
      'com-finmgr',
      'FINANCE_COLLECTIONS_OFFICER',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    const { policyId, insurerId } = await issuedPolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'main',
    );

    // no agreement yet -> calculate is a 422
    await request(app.getHttpServer())
      .post('/commission/entries')
      .set(bearer(fin.accessToken))
      .send({ policyId })
      .expect(422);

    // Finance cannot alter the rate table
    await request(app.getHttpServer())
      .post('/commission/agreements')
      .set(bearer(fin.accessToken))
      .send({
        insurerId,
        insuranceLine: 'Property All Risks',
        ratePercent: '15',
      })
      .expect(403);

    // Compliance opens a governed window covering the policy's inception
    const ag = await request(app.getHttpServer())
      .post('/commission/agreements')
      .set(bearer(comp.accessToken))
      .send({
        insurerId,
        insuranceLine: 'Property All Risks',
        ratePercent: '15',
        effectiveFrom: '2026-01-01',
      })
      .expect(201);
    expect((ag.body as AgreementBody).ratePercent).toBe('15.00');
    expect((ag.body as AgreementBody).isOpen).toBe(true);

    // a non-Finance actor cannot calculate
    await request(app.getHttpServer())
      .post('/commission/entries')
      .set(bearer(plc.accessToken))
      .send({ policyId })
      .expect(403);

    // Finance applies the governed rate: 120000 x 15% = 18000
    const calc = await request(app.getHttpServer())
      .post('/commission/entries')
      .set(bearer(fin.accessToken))
      .send({ policyId })
      .expect(201);
    const entry = calc.body as EntryBody;
    expect(entry.amount).toBe('18000.000');
    expect(entry.effectiveAmount).toBe('18000.000');
    expect(entry.commissionAgreementId).toBe((ag.body as AgreementBody).id);
    expect(entry.isManualOverride).toBe(false);
    expect(entry.status).toBe('outstanding');

    // write-once: a re-calc returns the same entry
    const recalc = await request(app.getHttpServer())
      .post('/commission/entries')
      .set(bearer(fin.accessToken))
      .send({ policyId })
      .expect(201);
    expect((recalc.body as EntryBody).id).toBe(entry.id);

    // the dual-hatted user raises a manual override
    const reason = 'Negotiated a lower book rate for this key account renewal.';
    const raised = await request(app.getHttpServer())
      .post(`/commission/entries/${entry.id}/override`)
      .set(bearer(finMgr.accessToken))
      .send({ overrideAmount: '12000.000', reason })
      .expect(201);
    const pending = raised.body as EntryBody;
    expect(pending.isManualOverride).toBe(true);
    expect(pending.overrideAmount).toBe('12000.000');
    expect(pending.amount).toBe('18000.000'); // governed still governs
    expect(pending.effectiveAmount).toBe('18000.000');
    expect(pending.overridePending).toBe(true);
    expect(pending.overrideApprovedByUserId).toBeNull();

    // the raiser cannot approve their own override — 403 from assertDifferentActors
    await request(app.getHttpServer())
      .post(`/commission/entries/${entry.id}/override/approve`)
      .set(bearer(finMgr.accessToken))
      .expect(403);
    // a Finance-only actor cannot approve at all (missing the permission)
    await request(app.getHttpServer())
      .post(`/commission/entries/${entry.id}/override/approve`)
      .set(bearer(fin.accessToken))
      .expect(403);

    // a distinct Manager approves: overrideAmount becomes the effective amount
    const approved = await request(app.getHttpServer())
      .post(`/commission/entries/${entry.id}/override/approve`)
      .set(bearer(mgr.accessToken))
      .expect(201);
    const done = approved.body as EntryBody;
    expect(done.overrideApprovedByUserId).toBe(mgr.userId);
    expect(done.amount).toBe('12000.000');
    expect(done.effectiveAmount).toBe('12000.000');
    expect(done.overridePending).toBe(false);

    // idempotent: the same approver again is a no-op 201
    await request(app.getHttpServer())
      .post(`/commission/entries/${entry.id}/override/approve`)
      .set(bearer(mgr.accessToken))
      .expect(201);

    // reads (financial-report.view — Manager holds it)
    const listed = await request(app.getHttpServer())
      .get(`/commission/entries?policyId=${policyId}`)
      .set(bearer(mgr.accessToken))
      .expect(200);
    expect((listed.body as EntryBody[]).map((e) => e.id)).toEqual([entry.id]);
    const got = await request(app.getHttpServer())
      .get(`/commission/entries/${entry.id}`)
      .set(bearer(mgr.accessToken))
      .expect(200);
    expect((got.body as EntryBody).effectiveAmount).toBe('12000.000');

    // audit: one CREATE CommissionLedgerEntry + one APPROVE row for this entry
    const auditRows = await prisma.auditLogEntry.findMany({
      where: { entityType: 'CommissionLedgerEntry', entityId: entry.id },
    });
    const actions = auditRows.map((r) => r.action).sort();
    expect(actions).toContain('CREATE');
    expect(actions).toContain('APPROVE');
    const approveRow = auditRows.find((r) => r.action === 'APPROVE');
    expect(JSON.stringify(approveRow?.afterValue)).toContain(reason);

    // supersede: a new window closes the '15' one
    await request(app.getHttpServer())
      .post('/commission/agreements')
      .set(bearer(mgr.accessToken))
      .send({
        insurerId,
        insuranceLine: 'Property All Risks',
        ratePercent: '10',
        effectiveFrom: '2026-06-01',
      })
      .expect(201);
    const agreements = await request(app.getHttpServer())
      .get(`/commission/agreements?insurerId=${insurerId}`)
      .set(bearer(mgr.accessToken))
      .expect(200);
    const rows = agreements.body as AgreementBody[];
    expect(rows).toHaveLength(2);
    const open = rows.filter((r) => r.isOpen);
    expect(open).toHaveLength(1);
    expect(open[0]?.ratePercent).toBe('10.00');
    const closed = rows.find((r) => !r.isOpen);
    expect(closed?.ratePercent).toBe('15.00');
    expect(closed?.effectiveTo).toBe('2026-06-01T00:00:00.000Z');

    // the insurer helper list includes our insurer
    const insurers = await request(app.getHttpServer())
      .get('/commission/insurers')
      .set(bearer(comp.accessToken))
      .expect(200);
    expect(
      (insurers.body as { id: string }[]).some((i) => i.id === insurerId),
    ).toBe(true);
  });
});
