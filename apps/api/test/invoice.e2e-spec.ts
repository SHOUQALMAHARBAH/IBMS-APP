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
function isoDaysAhead(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
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
}
interface InvoiceBody {
  id: string;
  policyId: string | null;
  customerId: string;
  invoiceType: string;
  premiumAmount: string;
  taxAmount: string;
  feesAmount: string;
  commissionDeducted: string;
  totalAmount: string;
  currency: string;
  dueDate: string;
  status: string;
  createdAt: string;
  receipt: {
    id: string;
    amount: string;
    method: string | null;
    paymentChannelId: string | null;
  } | null;
  // Process 32 — an invoice may be settled in instalments.
  receipts: {
    id: string;
    amount: string;
    method: string | null;
    paymentChannelId: string | null;
  }[];
  collectedAmount: string;
  outstandingAmount: string;
  fullyCollected: boolean;
  remittance: {
    id: string;
    amount: string;
    insurerId: string;
    paymentChannelId: string | null;
    remittedAt: string | null;
  } | null;
}

interface PaymentChannelBody {
  id: string;
  ownerType: string;
  customerId: string | null;
  insurerId: string | null;
  channelType: string;
  label: string;
  accountLast4: string | null;
  status: string;
  isActive: boolean;
}

interface AgeingRow {
  customerId: string;
  customerLegalName: string;
  currency: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
  outstandingTotal: string;
  invoiceCount: number;
  oldestDueDate: string | null;
  oldestDaysOverdue: number;
}
interface AgeingReport {
  asOf: string;
  currency: string;
  rows: AgeingRow[];
  totals: {
    current: string;
    d1_30: string;
    d31_60: string;
    d61_90: string;
    d90_plus: string;
    outstandingTotal: string;
    invoiceCount: number;
    customerCount: number;
  };
}

interface InsurerPayableRow {
  insurerId: string;
  insurerName: string;
  outstandingAmount: string;
  outstandingCount: number;
  oldestCollectedAt: string | null;
  oldestDaysOutstanding: number;
  remittedAmount: string;
  remittedCount: number;
}
interface InsurerPayablesReport {
  asOf: string;
  currency: string;
  rows: InsurerPayableRow[];
  totals: {
    outstandingAmount: string;
    outstandingCount: number;
    remittedAmount: string;
    remittedCount: number;
    insurerCount: number;
  };
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
    .send({ fullName: 'Invoice E2E User', email, password: PASSWORD })
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

/** Place + issue + check + deliver + acknowledge — an ACTIVE policy whose
 * placed quote carries `commissionRatePercent = 12` and whose `issuedPremium`
 * is `120000.000` (so the #31 invoice nets a `14400.000` commission). */
async function activePolicy(
  app: INestApplication<App>,
  placerToken: string,
  checkerToken: string,
  ownerUserId: string,
  tag: string,
): Promise<{ policyId: string; customerId: string }> {
  const rand = Math.random().toString(36).slice(2, 8);
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `Invoice E2E ${tag} ${rand}`,
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
    data: { name: `Invoice E2E ${tag} ins ${rand}` },
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
      evidenceRef: `inv-${tag}`,
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
  const policyId = (placed.body as PolicyBody).id;
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/issuance`)
    .set(bearer(placerToken))
    .send({
      policyNumber: `POL-INV-${Date.now()}-${rand}`,
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
  await request(app.getHttpServer())
    .post(`/policies/${policyId}/delivery/acknowledge-receipt`)
    .set(bearer(placerToken))
    .send({})
    .expect(201);
  return { policyId, customerId: customer.id };
}

describe('Premium Billing / Invoice (e2e) — backlog Part C #31', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('raises a premium invoice — premium carried, commission auto-netted, total computed — and reads it back; a non-finance actor is 403', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'inv-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'inv-chk', 'POLICY_CHECKING_OFFICER');
    const fin = await makeUser(app, 'inv-fin', 'FINANCE_COLLECTIONS_OFFICER');

    const { policyId, customerId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'raise',
    );

    // the placer (SALES + PLACEMENT, no finance perm) cannot raise or read
    await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(plc.accessToken))
      .send({ policyId, taxAmount: '9600.000', dueDate: isoDaysAhead(30) })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/invoices?policyId=${policyId}`)
      .set(bearer(plc.accessToken))
      .expect(403);

    // a past due date and one more than a year out are both 422 (new-invoice
    // window check) — no invoice exists yet on this policy
    await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({ policyId, taxAmount: '9600.000', dueDate: isoDaysAhead(-2) })
      .expect(422);
    await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({ policyId, taxAmount: '9600.000', dueDate: isoDaysAhead(400) })
      .expect(422);

    const raised = await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({
        policyId,
        taxAmount: '9600.000',
        feesAmount: '150.000',
        dueDate: isoDaysAhead(30),
      })
      .expect(201);
    const inv = raised.body as InvoiceBody;
    expect(inv.invoiceType).toBe('new_business_premium');
    expect(inv.customerId).toBe(customerId);
    expect(inv.premiumAmount).toBe('120000.000'); // carried from issuedPremium
    expect(inv.commissionDeducted).toBe('14400.000'); // 120000 * 12%
    expect(inv.taxAmount).toBe('9600.000');
    expect(inv.feesAmount).toBe('150.000');
    expect(inv.totalAmount).toBe('115350.000'); // 120000 + 9600 + 150 - 14400
    expect(inv.currency).toBe('JOD');
    expect(inv.status).toBe('INVOICED');

    const got = await request(app.getHttpServer())
      .get(`/invoices/${inv.id}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((got.body as InvoiceBody).id).toBe(inv.id);

    const listed = await request(app.getHttpServer())
      .get(`/invoices?policyId=${policyId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((listed.body as InvoiceBody[]).map((r) => r.id)).toEqual([inv.id]);

    // exactly one CREATE Invoice audit row for this invoice
    const auditRows = await prisma.auditLogEntry.findMany({
      where: {
        entityType: 'Invoice',
        action: 'CREATE',
        entityId: inv.id,
      },
    });
    expect(auditRows).toHaveLength(1);
    expect(JSON.stringify(auditRows[0]?.afterValue)).toContain('115350.000');

    // a book-wide read (no scope) is a 400 — that is Process 33's report
    await request(app.getHttpServer())
      .get('/invoices')
      .set(bearer(fin.accessToken))
      .expect(400);
  });

  it('Part F item #7 — generates a bilingual invoice PDF on demand, gated on the flat client-accounting.read permission (no per-customer scoping)', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'invdoc-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'invdoc-chk', 'POLICY_CHECKING_OFFICER');
    const fin = await makeUser(
      app,
      'invdoc-fin',
      'FINANCE_COLLECTIONS_OFFICER',
    );
    // client-accounting.read is also granted to MANAGER/EXEC/AUDITOR —
    // exercised here to prove the permission is genuinely book-wide, not
    // owner-scoped (unlike Policy/ComparisonMatrix/Recommendation's own
    // document endpoints).
    const auditor = await makeUser(app, 'invdoc-aud', 'EXTERNAL_AUDITOR');
    const noPerm = await makeUser(
      app,
      'invdoc-none',
      'DATA_PROTECTION_OFFICER',
    );

    const { policyId, customerId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'doc',
    );
    // AR is prisma's own default customer languagePreference — set
    // explicitly so the default-language assertion below is not relying
    // on an unstated default.
    await prisma.customer.update({
      where: { id: customerId },
      data: { languagePreference: 'AR' },
    });

    const raised = await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({
        policyId,
        taxAmount: '9600.000',
        feesAmount: '150.000',
        dueDate: isoDaysAhead(30),
      })
      .expect(201);
    const invoiceId = (raised.body as InvoiceBody).id;

    // forbidden without client-accounting.read
    await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}/document`)
      .set(bearer(noPerm.accessToken))
      .expect(403);

    // unknown invoice -> 404
    await request(app.getHttpServer())
      .get('/invoices/11111111-1111-4111-8111-111111111111/document')
      .set(bearer(fin.accessToken))
      .expect(404);

    // default: AR customer -> a real PDF, no explicit language needed
    const arDefault = await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}/document`)
      .set(bearer(fin.accessToken))
      .expect(200);
    expect(arDefault.headers['content-type']).toContain('application/pdf');
    const arBuffer = arDefault.body as Buffer;
    expect(arBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // an Auditor (book-wide client-accounting.read, no ownership relation
    // to this customer at all) reaches it too — proving the permission is
    // genuinely flat, not scoped
    const auditorRes = await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}/document`)
      .set(bearer(auditor.accessToken))
      .expect(200);
    expect((auditorRes.body as Buffer).subarray(0, 5).toString('latin1')).toBe(
      '%PDF-',
    );

    // explicit override: AR customer, ask for EN anyway
    const overridden = await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}/document?language=EN`)
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((overridden.body as Buffer).subarray(0, 5).toString('latin1')).toBe(
      '%PDF-',
    );

    // DUAL renders genuinely more content than a single-language document
    const dual = await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}/document?language=DUAL`)
      .set(bearer(fin.accessToken))
      .expect(200);
    const dualBuffer = dual.body as Buffer;
    expect(dualBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(dualBuffer.length).toBeGreaterThan(arBuffer.length);

    // an invalid language value 400s (class-validator @IsIn)
    await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}/document?language=FR`)
      .set(bearer(fin.accessToken))
      .expect(400);

    // collect the invoice, then the receipt appears on the document too
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '115350.000',
        method: 'bank_transfer',
        reference: 'E2E-REF-549',
      })
      .expect(201);
    const withReceipt = await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}/document`)
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((withReceipt.body as Buffer).subarray(0, 5).toString('latin1')).toBe(
      '%PDF-',
    );
  }, 45000);

  it('is write-once: a byte-identical re-post resumes the same invoice, and any changed figure (or due date) is a 409', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'inv2-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'inv2-chk', 'POLICY_CHECKING_OFFICER');
    const fin = await makeUser(app, 'inv2-fin', 'FINANCE_COLLECTIONS_OFFICER');
    const { policyId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'wonce',
    );

    const body = {
      policyId,
      taxAmount: '9600.000',
      feesAmount: '150.000',
      dueDate: isoDaysAhead(30),
    };
    const first = await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send(body)
      .expect(201);
    const resumed = await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send(body)
      .expect(201);
    expect((resumed.body as InvoiceBody).id).toBe(
      (first.body as InvoiceBody).id,
    );

    await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({ ...body, feesAmount: '999.000' })
      .expect(409);

    // a changed due date on an already-billed policy is also a 409 (the
    // figures-and-date match gate runs before the window check)
    await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({ ...body, dueDate: isoDaysAhead(45) })
      .expect(409);

    // still exactly one invoice on the policy
    const listed = await request(app.getHttpServer())
      .get(`/invoices?policyId=${policyId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    expect(listed.body as InvoiceBody[]).toHaveLength(1);
  });

  it('runs the full collection cycle: receipt -> reconcile -> remittance, with a client-funds ledger entry at each money movement (Part C #32)', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'inv3-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'inv3-chk', 'POLICY_CHECKING_OFFICER');
    const fin = await makeUser(app, 'inv3-fin', 'FINANCE_COLLECTIONS_OFFICER');
    const { policyId, customerId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'cycle',
    );

    const raised = await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({
        policyId,
        taxAmount: '9600.000',
        feesAmount: '150.000',
        dueDate: isoDaysAhead(30),
      })
      .expect(201);
    const invoiceId = (raised.body as InvoiceBody).id;
    // total = 120000 + 9600 + 150 - 14400
    expect((raised.body as InvoiceBody).totalAmount).toBe('115350.000');

    // the placer (no finance perm) cannot drive any cycle step
    for (const path of ['receipt', 'reconcile', 'remittance']) {
      await request(app.getHttpServer())
        .post(`/invoices/${invoiceId}/${path}`)
        .set(bearer(plc.accessToken))
        .send(path === 'reconcile' ? undefined : { amount: '115350.000' })
        .expect(403);
    }

    // reconcile / remittance are 422 before there is a receipt
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/reconcile`)
      .set(bearer(fin.accessToken))
      .expect(422);
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/remittance`)
      .set(bearer(fin.accessToken))
      .send({})
      .expect(422);

    // 1a. A SHORT payment is a legitimate instalment (partial payments,
    //     IMPROVEMENTS.md §3.4) — the money is booked but the invoice stays
    //     INVOICED, which is what keeps it on the #33 ageing report for the
    //     remaining balance and off the #34 payables report.
    const partial = await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '100000.000',
        method: 'bank_transfer',
        reference: 'E2E-REF-679',
      })
      .expect(201);
    expect((partial.body as InvoiceBody).status).toBe('INVOICED');
    expect((partial.body as InvoiceBody).collectedAmount).toBe('100000.000');
    expect((partial.body as InvoiceBody).outstandingAmount).toBe('15350.000');
    expect((partial.body as InvoiceBody).fullyCollected).toBe(false);

    // An OVER payment is still a 422 — never a silent write-off. 15,350 is
    // outstanding, so 20,000 would overshoot the invoiced total.
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '20000.000',
        method: 'bank_transfer',
        reference: 'E2E-REF-691',
      })
      .expect(422);

    // 1b. the instalment that settles the balance -> COLLECTED. It carries a
    //     payment `reference`, which is what makes a retry of THIS call
    //     idempotent (asserted below).
    const collected = await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '15350.000',
        method: 'bank_transfer',
        reference: 'BANK-REF-FINAL',
      })
      .expect(201);
    expect((collected.body as InvoiceBody).status).toBe('COLLECTED');
    expect((collected.body as InvoiceBody).collectedAmount).toBe('115350.000');
    expect((collected.body as InvoiceBody).outstandingAmount).toBe('0.000');
    expect((collected.body as InvoiceBody).fullyCollected).toBe(true);
    expect((collected.body as InvoiceBody).receipts).toHaveLength(2);

    // A further receipt on a settled invoice is an over payment -> 422.
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '1.000',
        method: 'bank_transfer',
        reference: 'E2E-REF-716',
      })
      .expect(422);

    // Idempotent RETRY: the same payment reference resumes the same receipt
    // rather than booking a second instalment. Since an invoice may legitimately
    // take several receipts of the same amount, the reference — not the figures
    // — is what distinguishes a retry from a genuine second payment.
    const collectedAgain = await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '15350.000',
        method: 'bank_transfer',
        reference: 'BANK-REF-FINAL',
      })
      .expect(201);
    expect((collectedAgain.body as InvoiceBody).receipts).toHaveLength(2);
    expect((collectedAgain.body as InvoiceBody).receipt?.id).toBe(
      (collected.body as InvoiceBody).receipt?.id,
    );

    // The same reference with a DIFFERENT amount is a 409 — a recorded receipt
    // is never amended.
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({ amount: '99.000', reference: 'BANK-REF-FINAL' })
      .expect(409);

    // 2. reconcile -> RECONCILED (idempotent)
    const reconciled = await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/reconcile`)
      .set(bearer(fin.accessToken))
      .expect(201);
    expect((reconciled.body as InvoiceBody).status).toBe('RECONCILED');
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/reconcile`)
      .set(bearer(fin.accessToken))
      .expect(201);

    // 3. remittance -> REMITTED, amount = premium - commission
    const remitted = await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/remittance`)
      .set(bearer(fin.accessToken))
      .send({})
      .expect(201);
    expect((remitted.body as InvoiceBody).status).toBe('REMITTED');
    expect((remitted.body as InvoiceBody).remittance?.amount).toBe(
      '105600.000',
    ); // 120000 - 14400
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/remittance`)
      .set(bearer(fin.accessToken))
      .send({})
      .expect(201);

    // exactly three TRANSITION audit rows for this invoice
    const transitions = await prisma.auditLogEntry.findMany({
      where: {
        entityType: 'Invoice',
        action: 'TRANSITION',
        entityId: invoiceId,
      },
    });
    expect(transitions).toHaveLength(3);

    // TWO receipts — the two instalments above — and no more. The retries and
    // the over-payment attempts each booked nothing: with `Receipt.invoiceId`
    // no longer UNIQUE, this count is the real evidence that the serialised
    // write + the reference idempotency key hold the line.
    expect(await prisma.receipt.count({ where: { invoiceId } })).toBe(2);

    // One "in" ledger entry PER INSTALMENT, one "out" at the remittance —
    // client money is booked exactly once per movement (Part 7.3).
    const ledger = await prisma.clientFundsLedgerEntry.findMany({
      where: { customerId, reference: `invoice:${invoiceId}` },
      orderBy: { recordedAt: 'asc' },
    });
    expect(ledger).toHaveLength(3);
    expect(ledger[0]?.direction).toBe('in');
    expect(ledger[0]?.amount.toString()).toBe('100000');
    expect(ledger[1]?.direction).toBe('in');
    expect(ledger[1]?.amount.toString()).toBe('15350');
    // The two instalments sum to the invoiced total, nothing double-booked.
    expect(
      Number(ledger[0]?.amount ?? 0) + Number(ledger[1]?.amount ?? 0),
    ).toBe(115350);
    expect(ledger[2]?.direction).toBe('out');
    expect(ledger[2]?.amount.toString()).toBe('105600');
  });

  it('serves the client accounts-receivable / ageing report — outstanding while unpaid, bucketed by dueDate vs asOf, gone once collected (Part C #33)', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'inv4-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'inv4-chk', 'POLICY_CHECKING_OFFICER');
    const fin = await makeUser(app, 'inv4-fin', 'FINANCE_COLLECTIONS_OFFICER');
    const { policyId, customerId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'ageing',
    );

    const raised = await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({
        policyId,
        taxAmount: '9600.000',
        feesAmount: '150.000',
        dueDate: isoDaysAhead(30),
      })
      .expect(201);
    const invoiceId = (raised.body as InvoiceBody).id;

    // a non-finance actor cannot read the report
    await request(app.getHttpServer())
      .get('/client-accounting/ageing')
      .set(bearer(plc.accessToken))
      .expect(403);

    // a future asOf is a 422
    await request(app.getHttpServer())
      .get(`/client-accounting/ageing?asOf=${isoDaysAhead(2)}`)
      .set(bearer(fin.accessToken))
      .expect(422);

    // scoped to this customer: one outstanding invoice, due in 30 days -> current
    const current = await request(app.getHttpServer())
      .get(`/client-accounting/ageing?customerId=${customerId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    const curBody = current.body as AgeingReport;
    expect(curBody.currency).toBe('JOD');
    expect(curBody.rows).toHaveLength(1);
    expect(curBody.rows[0]).toMatchObject({
      customerId,
      current: '115350.000',
      d1_30: '0.000',
      d31_60: '0.000',
      d61_90: '0.000',
      d90_plus: '0.000',
      outstandingTotal: '115350.000',
      invoiceCount: 1,
    });
    expect(curBody.rows[0]?.oldestDaysOverdue).toBeLessThanOrEqual(0);
    expect(curBody.totals).toMatchObject({
      outstandingTotal: '115350.000',
      invoiceCount: 1,
      customerCount: 1,
    });

    // an asOf before the invoice was raised -> it did not exist yet -> absent
    const beforeItExisted = await request(app.getHttpServer())
      .get(`/client-accounting/ageing?customerId=${customerId}&asOf=2020-01-01`)
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((beforeItExisted.body as AgeingReport).rows).toHaveLength(0);

    // backdate the due date 45 days -> the same balance now ages into d31_60
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { dueDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000) },
    });
    const aged = await request(app.getHttpServer())
      .get(`/client-accounting/ageing?customerId=${customerId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    const agedRow = (aged.body as AgeingReport).rows[0];
    expect(agedRow).toMatchObject({
      current: '0.000',
      d1_30: '0.000',
      d31_60: '115350.000',
      d61_90: '0.000',
      d90_plus: '0.000',
      outstandingTotal: '115350.000',
    });
    expect(agedRow?.oldestDaysOverdue).toBeGreaterThanOrEqual(44);
    expect(agedRow?.oldestDaysOverdue).toBeLessThanOrEqual(46);

    // collect it in full -> no longer outstanding
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '115350.000',
        method: 'bank_transfer',
        reference: 'E2E-REF-906',
      })
      .expect(201);
    const settled = await request(app.getHttpServer())
      .get(`/client-accounting/ageing?customerId=${customerId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    const settledBody = settled.body as AgeingReport;
    expect(settledBody.rows).toHaveLength(0);
    expect(settledBody.totals).toMatchObject({
      outstandingTotal: '0.000',
      invoiceCount: 0,
      customerCount: 0,
    });

    // an unknown customer scope is simply empty
    const unknown = await request(app.getHttpServer())
      .get(
        '/client-accounting/ageing?customerId=00000000-0000-4000-8000-000000000000',
      )
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((unknown.body as AgeingReport).rows).toHaveLength(0);
  });

  it('serves the insurer accounts-payable report — owed once collected & unremitted, moved to remitted once paid (Part C #34)', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'inv5-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'inv5-chk', 'POLICY_CHECKING_OFFICER');
    const fin = await makeUser(app, 'inv5-fin', 'FINANCE_COLLECTIONS_OFFICER');
    const { policyId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'payables',
    );
    const policy = await prisma.policy.findUniqueOrThrow({
      where: { id: policyId },
      select: { insurerId: true },
    });
    const insurerId = policy.insurerId;

    const raised = await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({
        policyId,
        taxAmount: '9600.000',
        feesAmount: '150.000',
        dueDate: isoDaysAhead(30),
      })
      .expect(201);
    const invoiceId = (raised.body as InvoiceBody).id;

    // a non-finance actor cannot read the report
    await request(app.getHttpServer())
      .get('/insurer-accounting/payables')
      .set(bearer(plc.accessToken))
      .expect(403);
    // a future asOf is a 422
    await request(app.getHttpServer())
      .get(`/insurer-accounting/payables?asOf=${isoDaysAhead(2)}`)
      .set(bearer(fin.accessToken))
      .expect(422);

    // nothing collected yet -> the insurer is not in the report
    const dry = await request(app.getHttpServer())
      .get(`/insurer-accounting/payables?insurerId=${insurerId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((dry.body as InsurerPayablesReport).rows).toHaveLength(0);

    // collect the client's premium (-> COLLECTED) but do not remit yet
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '115350.000',
        method: 'bank_transfer',
        reference: 'E2E-REF-987',
      })
      .expect(201);

    const owed = await request(app.getHttpServer())
      .get(`/insurer-accounting/payables?insurerId=${insurerId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    const owedBody = owed.body as InsurerPayablesReport;
    expect(owedBody.currency).toBe('JOD');
    expect(owedBody.rows).toHaveLength(1);
    expect(owedBody.rows[0]).toMatchObject({
      insurerId,
      outstandingAmount: '105600.000', // 120000 premium - 14400 commission
      outstandingCount: 1,
      remittedAmount: '0.000',
      remittedCount: 0,
    });
    expect(owedBody.rows[0]?.oldestDaysOutstanding).toBeGreaterThanOrEqual(0);
    expect(owedBody.rows[0]?.oldestDaysOutstanding).toBeLessThanOrEqual(1);
    expect(owedBody.totals).toMatchObject({
      outstandingAmount: '105600.000',
      outstandingCount: 1,
      remittedAmount: '0.000',
      remittedCount: 0,
      insurerCount: 1,
    });

    // as at a date before the receipt: nothing was collected -> not in the report
    const past = await request(app.getHttpServer())
      .get(
        `/insurer-accounting/payables?insurerId=${insurerId}&asOf=2020-01-01`,
      )
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((past.body as InsurerPayablesReport).rows).toHaveLength(0);

    // reconcile + remit -> the obligation moves from outstanding to remitted
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/reconcile`)
      .set(bearer(fin.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/remittance`)
      .set(bearer(fin.accessToken))
      .send({})
      .expect(201);

    const remitted = await request(app.getHttpServer())
      .get(`/insurer-accounting/payables?insurerId=${insurerId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    const remittedBody = remitted.body as InsurerPayablesReport;
    expect(remittedBody.rows[0]).toMatchObject({
      insurerId,
      outstandingAmount: '0.000',
      outstandingCount: 0,
      oldestCollectedAt: null,
      oldestDaysOutstanding: -1,
      remittedAmount: '105600.000',
      remittedCount: 1,
    });
    expect(remittedBody.totals).toMatchObject({
      outstandingAmount: '0.000',
      remittedAmount: '105600.000',
      remittedCount: 1,
      insurerCount: 1,
    });

    // an unknown insurer scope is simply empty
    const unknownIns = await request(app.getHttpServer())
      .get(
        '/insurer-accounting/payables?insurerId=00000000-0000-4000-8000-000000000000',
      )
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((unknownIns.body as InsurerPayablesReport).rows).toHaveLength(0);
  });

  it('Process 38 — records approved payment channels and threads them through the collection cycle', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'inv38-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'inv38-chk', 'POLICY_CHECKING_OFFICER');
    const fin = await makeUser(app, 'inv38-fin', 'FINANCE_COLLECTIONS_OFFICER');
    const { policyId, customerId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'chan',
    );
    const policyRow = await prisma.policy.findUniqueOrThrow({
      where: { id: policyId },
      select: { insurerId: true },
    });
    const insurerId = policyRow.insurerId;

    // a non-Finance actor cannot maintain the channel list
    await request(app.getHttpServer())
      .post('/payment-channels')
      .set(bearer(plc.accessToken))
      .send({
        ownerType: 'customer',
        customerId,
        channelType: 'bank_transfer',
        label: 'x',
      })
      .expect(403);

    // a full account/card number in the free-text label or bankName -> 400
    // (the shared DTO guard — accountLast4 is the only governed bank fragment)
    await request(app.getHttpServer())
      .post('/payment-channels')
      .set(bearer(fin.accessToken))
      .send({
        ownerType: 'customer',
        customerId,
        channelType: 'bank_transfer',
        label: 'Client account 0123456789',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/payment-channels')
      .set(bearer(fin.accessToken))
      .send({
        ownerType: 'customer',
        customerId,
        channelType: 'bank_transfer',
        label: 'Client — Cairo Amman JOD',
        bankName: 'Cairo Amman Bank IBAN JO94CBJO0010000000000131000302',
      })
      .expect(400);

    // Finance adds an approved customer channel + an insurer channel
    const custChan = await request(app.getHttpServer())
      .post('/payment-channels')
      .set(bearer(fin.accessToken))
      .send({
        ownerType: 'customer',
        customerId,
        channelType: 'bank_transfer',
        label: 'Client — Cairo Amman JOD',
        bankName: 'Cairo Amman Bank',
        accountLast4: '4321',
      })
      .expect(201);
    const custChanId = (custChan.body as PaymentChannelBody).id;
    expect((custChan.body as PaymentChannelBody).isActive).toBe(true);
    expect((custChan.body as PaymentChannelBody).accountLast4).toBe('4321');

    const insChan = await request(app.getHttpServer())
      .post('/payment-channels')
      .set(bearer(fin.accessToken))
      .send({
        ownerType: 'insurer',
        insurerId,
        channelType: 'cheque',
        label: 'Insurer settlement',
      })
      .expect(201);
    const insChanId = (insChan.body as PaymentChannelBody).id;

    // a disabled channel is rejected — make one, disable it, try to use it
    const deadChan = await request(app.getHttpServer())
      .post('/payment-channels')
      .set(bearer(fin.accessToken))
      .send({
        ownerType: 'customer',
        customerId,
        channelType: 'cash',
        label: 'Old petty-cash route',
      })
      .expect(201);
    const deadChanId = (deadChan.body as PaymentChannelBody).id;
    const disabled = await request(app.getHttpServer())
      .post(`/payment-channels/${deadChanId}/disable`)
      .set(bearer(fin.accessToken))
      .expect(201);
    expect((disabled.body as PaymentChannelBody).status).toBe('disabled');
    // disable is idempotent
    await request(app.getHttpServer())
      .post(`/payment-channels/${deadChanId}/disable`)
      .set(bearer(fin.accessToken))
      .expect(201);

    // raise the invoice
    const raised = await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({
        policyId,
        taxAmount: '9600.000',
        feesAmount: '150.000',
        dueDate: isoDaysAhead(30),
      })
      .expect(201);
    const invoiceId = (raised.body as InvoiceBody).id;

    // a receipt against a disabled channel -> 422
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '115350.000',
        paymentChannelId: deadChanId,
        reference: 'E2E-REF-1193',
      })
      .expect(422);
    // a receipt against the INSURER channel (wrong owner) -> 422
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '115350.000',
        paymentChannelId: insChanId,
        reference: 'E2E-REF-1199',
      })
      .expect(422);
    // an explicit method conflicting with the channel type -> 422
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '115350.000',
        method: 'cheque',
        paymentChannelId: custChanId,
        reference: 'E2E-REF-1205',
      })
      .expect(422);

    // a clean receipt against the approved customer channel: method derived
    const collected = await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '115350.000',
        paymentChannelId: custChanId,
        reference: 'BANK-REF-1',
      })
      .expect(201);
    expect((collected.body as InvoiceBody).receipt?.paymentChannelId).toBe(
      custChanId,
    );
    expect((collected.body as InvoiceBody).receipt?.method).toBe(
      'bank_transfer',
    );

    // Since partial payments landed, the figures alone can no longer tell a
    // retry from a genuine second instalment, so the client's payment
    // `reference` is the idempotency key. Same reference + DIFFERENT channel
    // -> 409 (a recorded receipt is not amended).
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({ amount: '115350.000', reference: 'BANK-REF-1' })
      .expect(409);
    // byte-identical re-post on the same reference -> idempotent resume
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({
        amount: '115350.000',
        paymentChannelId: custChanId,
        reference: 'BANK-REF-1',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/reconcile`)
      .set(bearer(fin.accessToken))
      .expect(201);

    // a remittance against the CUSTOMER channel (wrong owner) -> 422
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/remittance`)
      .set(bearer(fin.accessToken))
      .send({ paymentChannelId: custChanId })
      .expect(422);

    // a clean remittance against the approved insurer channel
    const remitted = await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/remittance`)
      .set(bearer(fin.accessToken))
      .send({ paymentChannelId: insChanId })
      .expect(201);
    expect((remitted.body as InvoiceBody).status).toBe('REMITTED');
    expect((remitted.body as InvoiceBody).remittance?.paymentChannelId).toBe(
      insChanId,
    );

    // the channel list read is Finance-scoped, filterable, and never leaks a
    // full account number (only the last-4 fragment exists)
    const list = await request(app.getHttpServer())
      .get(`/payment-channels?customerId=${customerId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    const rows = list.body as PaymentChannelBody[];
    expect(rows.map((r) => r.id).sort()).toEqual(
      [custChanId, deadChanId].sort(),
    );
    for (const r of rows) {
      if (r.accountLast4) expect(r.accountLast4.length).toBeLessThanOrEqual(4);
    }

    // audit: a CREATE PaymentChannel row exists and carries no account fragment
    const chanAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'PaymentChannel', entityId: custChanId },
    });
    expect(chanAudit.some((r) => r.action === 'CREATE')).toBe(true);
    expect(JSON.stringify(chanAudit)).not.toContain('4321');
  });

  it('Process 39 — bank reconciliation: a variance ALWAYS raises an exception, then the investigate/resolve path returns the invoice to the cycle', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'inv39-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'inv39-chk', 'POLICY_CHECKING_OFFICER');
    const fin = await makeUser(app, 'inv39-fin', 'FINANCE_COLLECTIONS_OFFICER');
    const mgr = await makeUser(app, 'inv39-mgr', 'BRANCH_DEPARTMENT_MANAGER');
    const { policyId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'recon',
    );

    const raised = await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({
        policyId,
        taxAmount: '9600.000',
        feesAmount: '150.000',
        dueDate: isoDaysAhead(30),
      })
      .expect(201);
    const invoiceId = (raised.body as InvoiceBody).id;
    // broker record for reconciliation = premium − commission = 120000 − 14400
    const BROKER_RECORD = '105600.000';

    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({ amount: '115350.000', reference: 'E2E-REF-1330' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/reconcile`)
      .set(bearer(fin.accessToken))
      .expect(201);

    // a non-Finance actor cannot run detection
    await request(app.getHttpServer())
      .post('/reconciliation-exceptions/detect')
      .set(bearer(plc.accessToken))
      .send({ lines: [{ invoiceId, insurerStatementAmount: BROKER_RECORD }] })
      .expect(403);

    // a matching statement line reconciles silently — no exception
    const matched = await request(app.getHttpServer())
      .post('/reconciliation-exceptions/detect')
      .set(bearer(fin.accessToken))
      .send({ lines: [{ invoiceId, insurerStatementAmount: BROKER_RECORD }] })
      .expect(201);
    expect((matched.body as { reconciled: number }).reconciled).toBe(1);
    expect(
      (matched.body as { exceptionsRaised: number }).exceptionsRaised,
    ).toBe(0);

    // a variance ALWAYS raises an exception with the EXACT amount, and drives
    // the invoice to EXCEPTION_RAISED
    const detected = await request(app.getHttpServer())
      .post('/reconciliation-exceptions/detect')
      .set(bearer(fin.accessToken))
      .send({
        lines: [{ invoiceId, insurerStatementAmount: '110600.000' }], // +5000
      })
      .expect(201);
    const dBody = detected.body as {
      exceptionsRaised: number;
      results: {
        outcome: string;
        exceptionId?: string;
        varianceAmount?: string;
      }[];
    };
    expect(dBody.exceptionsRaised).toBe(1);
    expect(dBody.results[0]?.outcome).toBe('exception_raised');
    expect(dBody.results[0]?.varianceAmount).toBe('5000.000');
    const exceptionId = dBody.results[0]?.exceptionId as string;

    const invAfterDetect = await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((invAfterDetect.body as InvoiceBody).status).toBe(
      'EXCEPTION_RAISED',
    );

    // re-detect → the same open exception (idempotent), no second row
    const reDetect = await request(app.getHttpServer())
      .post('/reconciliation-exceptions/detect')
      .set(bearer(fin.accessToken))
      .send({ lines: [{ invoiceId, insurerStatementAmount: '110600.000' }] })
      .expect(201);
    expect(
      (reDetect.body as { results: { outcome: string }[] }).results[0]?.outcome,
    ).toBe('exception_exists');

    const listed = await request(app.getHttpServer())
      .get(`/reconciliation-exceptions?invoiceId=${invoiceId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((listed.body as { id: string }[]).map((e) => e.id)).toEqual([
      exceptionId,
    ]);

    // investigate → investigating
    const investigated = await request(app.getHttpServer())
      .post(`/reconciliation-exceptions/${exceptionId}/investigate`)
      .set(bearer(fin.accessToken))
      .expect(201);
    expect((investigated.body as { status: string }).status).toBe(
      'investigating',
    );

    // resolve without resumeInvoiceAs is a 422 while the invoice is EXCEPTION_RAISED
    await request(app.getHttpServer())
      .post(`/reconciliation-exceptions/${exceptionId}/resolve`)
      .set(bearer(mgr.accessToken))
      .send({
        resolutionNote: 'Insurer statement applied an unbilled endorsement.',
      })
      .expect(422);

    // resolve (Manager holds reconciliation-exception.resolve) → resolved, and
    // the invoice returns to RECONCILED (NO figure adjusted — the variance
    // stays recorded on the exception)
    const NOTE =
      'Insurer statement double-counted a prior part-remittance; broker record stands.';
    const resolved = await request(app.getHttpServer())
      .post(`/reconciliation-exceptions/${exceptionId}/resolve`)
      .set(bearer(mgr.accessToken))
      .send({ resolutionNote: NOTE, resumeInvoiceAs: 'RECONCILED' })
      .expect(201);
    const rBody = resolved.body as {
      status: string;
      varianceAmount: string;
      resolutionNote: string;
    };
    expect(rBody.status).toBe('resolved');
    expect(rBody.varianceAmount).toBe('5000.000'); // unchanged
    expect(rBody.resolutionNote).toBe(NOTE);

    const invAfterResolve = await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}`)
      .set(bearer(fin.accessToken))
      .expect(200);
    expect((invAfterResolve.body as InvoiceBody).status).toBe('RECONCILED');

    // the cycle is usable again: the remittance now goes through
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/remittance`)
      .set(bearer(fin.accessToken))
      .send({})
      .expect(201);

    // idempotent re-resolve
    await request(app.getHttpServer())
      .post(`/reconciliation-exceptions/${exceptionId}/resolve`)
      .set(bearer(mgr.accessToken))
      .send({ resolutionNote: NOTE })
      .expect(201);

    // audit: a CREATE ReconciliationException + a resolve UPDATE carrying the note
    const reconAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'ReconciliationException', entityId: exceptionId },
    });
    const actions = reconAudit.map((r) => r.action).sort();
    expect(actions).toContain('CREATE');
    expect(actions).toContain('UPDATE');
    expect(JSON.stringify(reconAudit)).toContain(NOTE);
  });

  it('Process 40 — the consolidated financial-report summary composes AR / payables + a commission roll-up + a profitability section', async () => {
    const app = await boot();
    const plc = await makeUser(
      app,
      'inv40-plc',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const chk = await makeUser(app, 'inv40-chk', 'POLICY_CHECKING_OFFICER');
    const fin = await makeUser(app, 'inv40-fin', 'FINANCE_COLLECTIONS_OFFICER');
    const comp = await makeUser(app, 'inv40-comp', 'COMPLIANCE_OFFICER');
    const { policyId } = await activePolicy(
      app,
      plc.accessToken,
      chk.accessToken,
      plc.userId,
      'finrep',
    );
    const policy = await prisma.policy.findUniqueOrThrow({
      where: { id: policyId },
      select: { insurerId: true, insuranceLine: true },
    });

    // raise + collect the premium invoice (→ COLLECTED: not in AR, owed to insurer)
    const raised = await request(app.getHttpServer())
      .post('/invoices')
      .set(bearer(fin.accessToken))
      .send({
        policyId,
        taxAmount: '9600.000',
        feesAmount: '150.000',
        dueDate: isoDaysAhead(30),
      })
      .expect(201);
    const invoiceId = (raised.body as InvoiceBody).id;
    await request(app.getHttpServer())
      .post(`/invoices/${invoiceId}/receipt`)
      .set(bearer(fin.accessToken))
      .send({ amount: '115350.000', reference: 'E2E-REF-1508' })
      .expect(201);

    // a governed commission rate for the pair, then Finance calculates + settles
    await request(app.getHttpServer())
      .post('/commission/agreements')
      .set(bearer(comp.accessToken))
      .send({
        insurerId: policy.insurerId,
        insuranceLine: policy.insuranceLine,
        ratePercent: '12',
        effectiveFrom: '2026-01-01',
      })
      .expect(201);
    const calc = await request(app.getHttpServer())
      .post('/commission/entries')
      .set(bearer(fin.accessToken))
      .send({ policyId })
      .expect(201);
    const entryId = (calc.body as { id: string; amount: string }).id;
    expect((calc.body as { amount: string }).amount).toBe('14400.000'); // 120000 × 12%
    await request(app.getHttpServer())
      .post(`/commission/entries/${entryId}/settle`)
      .set(bearer(fin.accessToken))
      .send({ statementAmount: '14400.000', paymentReference: 'STMT-FR-1' })
      .expect(201);

    // a non-Finance actor cannot read the summary
    await request(app.getHttpServer())
      .get('/financial-report/summary')
      .set(bearer(plc.accessToken))
      .expect(403);

    // a future asOf is a 422
    await request(app.getHttpServer())
      .get(`/financial-report/summary?asOf=${isoDaysAhead(2)}`)
      .set(bearer(fin.accessToken))
      .expect(422);

    const summary = await request(app.getHttpServer())
      .get('/financial-report/summary')
      .set(bearer(fin.accessToken))
      .expect(200);
    const body = summary.body as {
      asOf: string;
      currency: string;
      receivables: { outstandingTotal: string; invoiceCount: number };
      payables: { outstandingAmount: string; remittedAmount: string };
      commission: {
        earned: string;
        paid: string;
        outstanding: string;
        byInsurer: { insurerId: string; earned: string; paid: string }[];
      };
      profitability: {
        byLine: {
          key: string;
          commissionEarned: string;
          netPosition: string;
        }[];
        bySegment: { key: string }[];
        totals: { premiumWritten: string; policyCount: number };
      };
    };

    expect(body.currency).toBe('JOD');
    // this invoice was collected → it is NOT in AR; it IS owed to the insurer
    // (premium − commission = 105600), nothing remitted yet
    const insurerRow = body.payables;
    expect(Number(insurerRow.outstandingAmount) >= 105600).toBe(true);
    // the commission roll-up sees this settled entry
    const cRow = body.commission.byInsurer.find(
      (r) => r.insurerId === policy.insurerId,
    );
    expect(cRow).toBeDefined();
    expect(Number(cRow?.paid)).toBeGreaterThanOrEqual(14400);
    // the profitability section groups the written policy by its line + segment
    const line = body.profitability.byLine.find(
      (r) => r.key === policy.insuranceLine,
    );
    expect(line).toBeDefined();
    expect(Number(line?.commissionEarned)).toBeGreaterThanOrEqual(14400);
    expect(
      body.profitability.bySegment.some((r) => r.key === 'CORPORATE'),
    ).toBe(true);
    expect(body.profitability.totals.policyCount).toBeGreaterThanOrEqual(1);

    // a best-effort READ audit row exists for the summary
    const frAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'FinancialReport', action: 'READ' },
    });
    expect(frAudit.length).toBeGreaterThanOrEqual(1);
  });
});
