import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceStatus, Prisma } from '@ibms/db';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { OPEN_INVOICE_STATUSES } from '../../repositories/invoice.repository';
import {
  NEW_BUSINESS_PREMIUM_INVOICE_TYPE,
  type InvoiceListRowView,
} from './finance.config';
import type { InvoiceRepository } from '../../repositories/invoice.repository';
import type { PolicyRepository } from '../../repositories/policy.repository';
import type { RecommendationRepository } from '../../repositories/recommendation.repository';
import type { CommissionRepository } from '../../repositories/commission.repository';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { withDerivedPermissions } from '../../../test/fixtures/authenticated-user';

const d = (s: string) => new Prisma.Decimal(s);

const actor: AuthenticatedUser = withDerivedPermissions({
  id: 'fin-1',
  organizationId: 'org-1',
  email: 'finance@ibms.test',
  roles: ['FINANCE_COLLECTIONS_OFFICER'],
  roleIds: [],
  sessionId: 's-1',
});

const POLICY = {
  id: 'pol-1',
  customerId: 'cust-1',
  opportunityId: 'opp-1',
  issuedPremium: d('1000.000'),
  currency: 'JOD',
};

function isoDaysAhead(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function makeDeps(over?: {
  policy?: unknown;
  rate?: Prisma.Decimal | null;
  existing?: unknown;
}) {
  const invoices = {
    findNewBusinessPremiumInvoice: vi
      .fn()
      .mockResolvedValue(over?.existing ?? null),
    create: vi.fn((row: Record<string, unknown>) =>
      Promise.resolve({
        id: 'inv-1',
        status: 'INVOICED',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
        ...row,
      }),
    ),
    findById: vi.fn(),
    findManyByPolicyId: vi.fn().mockResolvedValue([]),
    findManyByCustomerId: vi.fn().mockResolvedValue([]),
    /* DECISION 167/13 — the book-wide branch. Resolves an EMPTY page by default, so a test that
     * means to exercise it has to say so; a default page of rows would make every unrelated test
     * below silently depend on this shape. */
    findPageWithNames: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  };
  const policies = {
    findById: vi
      .fn()
      .mockResolvedValue(over?.policy === undefined ? POLICY : over.policy),
  };
  const recommendations = {
    findByOpportunityId: vi
      .fn()
      .mockResolvedValue(
        over?.rate === undefined
          ? { recommendedQuotation: { commissionRatePercent: d('12.5') } }
          : { recommendedQuotation: { commissionRatePercent: over.rate } },
      ),
  };
  // Mock for new findEffectiveAgreement method (Fix #1)
  const commissions = {
    findEffectiveAgreement: vi.fn().mockResolvedValue(null), // Fall back to quoted rate
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new InvoiceService(
    invoices as unknown as InvoiceRepository,
    policies as unknown as PolicyRepository,
    recommendations as unknown as RecommendationRepository,
    commissions as unknown as CommissionRepository,
    audit as unknown as AuditService,
  );
  return { service, invoices, policies, recommendations, commissions, audit };
}

const dto = () => ({
  policyId: 'pol-1',
  taxAmount: '160.000',
  feesAmount: '25.000',
  dueDate: isoDaysAhead(30),
});

describe('InvoiceService.create (Process 31)', () => {
  it('raises the invoice with server-composed figures and audits the CREATE', async () => {
    const { service, invoices, audit } = makeDeps();
    const view = await service.create(dto(), actor);

    expect(invoices.create).toHaveBeenCalledTimes(1);
    const row = invoices.create.mock.calls[0]?.[0];
    expect(row.customerId).toBe('cust-1'); // from the policy, never the DTO
    expect(row.invoiceType).toBe('new_business_premium');
    expect((row.premiumAmount as Prisma.Decimal).toFixed(3)).toBe('1000.000');
    expect((row.commissionDeducted as Prisma.Decimal).toFixed(3)).toBe(
      '125.000',
    ); // 1000 * 12.5%
    expect((row.totalAmount as Prisma.Decimal).toFixed(3)).toBe('1060.000'); // 1000 + 160 + 25 - 125
    expect(view.totalAmount).toBe('1060.000');
    expect(view.status).toBe('INVOICED');

    const auditArg = audit.record.mock.calls[0]?.[0] as {
      action: string;
      entityType: string;
      afterValue: Record<string, unknown>;
    };
    expect(auditArg.action).toBe('CREATE');
    expect(auditArg.entityType).toBe('Invoice');
    expect(auditArg.afterValue).toMatchObject({
      totalAmount: '1060.000',
      commissionRatePercent: '12.50',
    });
  });

  it('404s when the policy does not exist', async () => {
    const { service } = makeDeps({ policy: null });
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('422s when the policy has no issued premium', async () => {
    const { service } = makeDeps({
      policy: { ...POLICY, issuedPremium: null },
    });
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('422s when the placed quotation captured no commission rate', async () => {
    const { service } = makeDeps({ rate: null });
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('422s when tax exceeds the premium', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ ...dto(), taxAmount: '1000.001' }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s when fees exceed the premium', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ ...dto(), feesAmount: '5000.000' }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s when the due date is in the past', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ ...dto(), dueDate: isoDaysAhead(-1) }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s when the due date is more than a year ahead', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ ...dto(), dueDate: isoDaysAhead(400) }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s when the placed commission rate is outside 0..100 (billing-time backstop)', async () => {
    const { service } = makeDeps({ rate: d('150') });
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('is write-once: a byte-identical re-post returns the existing invoice without creating', async () => {
    const existing = {
      id: 'inv-existing',
      policyId: 'pol-1',
      customerId: 'cust-1',
      invoiceType: 'new_business_premium',
      premiumAmount: d('1000.000'),
      taxAmount: d('160.000'),
      feesAmount: d('25.000'),
      commissionDeducted: d('125.000'),
      totalAmount: d('1060.000'),
      currency: 'JOD',
      dueDate: new Date(`${isoDaysAhead(30)}T00:00:00.000Z`),
      status: 'INVOICED',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    };
    const { service, invoices } = makeDeps({ existing });
    const view = await service.create(dto(), actor);
    expect(view.id).toBe('inv-existing');
    expect(invoices.create).not.toHaveBeenCalled();
  });

  it('resumes a byte-identical re-post even after the stored due date has elapsed (resume runs before the window check)', async () => {
    const pastDue = isoDaysAhead(-5);
    const existing = {
      id: 'inv-existing',
      policyId: 'pol-1',
      customerId: 'cust-1',
      invoiceType: 'new_business_premium',
      premiumAmount: d('1000.000'),
      taxAmount: d('160.000'),
      feesAmount: d('25.000'),
      commissionDeducted: d('125.000'),
      totalAmount: d('1060.000'),
      currency: 'JOD',
      dueDate: new Date(`${pastDue}T00:00:00.000Z`),
      status: 'INVOICED',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    };
    const { service, invoices } = makeDeps({ existing });
    const view = await service.create({ ...dto(), dueDate: pastDue }, actor);
    expect(view.id).toBe('inv-existing');
    expect(invoices.create).not.toHaveBeenCalled();
  });

  it('409s when a premium invoice already exists with different figures', async () => {
    const existing = {
      id: 'inv-existing',
      policyId: 'pol-1',
      customerId: 'cust-1',
      invoiceType: 'new_business_premium',
      premiumAmount: d('1000.000'),
      taxAmount: d('160.000'),
      feesAmount: d('99.000'), // different
      commissionDeducted: d('125.000'),
      totalAmount: d('1134.000'),
      currency: 'JOD',
      dueDate: new Date(`${isoDaysAhead(30)}T00:00:00.000Z`),
      status: 'INVOICED',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    };
    const { service } = makeDeps({ existing });
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('maps a concurrent P2002 to a 409', async () => {
    const { service, invoices } = makeDeps();
    invoices.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(service.create(dto(), actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('does not fail the request if the audit write throws (already committed)', async () => {
    const { service, audit } = makeDeps();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(service.create(dto(), actor)).resolves.toMatchObject({
      id: 'inv-1',
    });
  });
});

describe('InvoiceService.list (Process 31)', () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps();
  });

  /*
   * 🔴 CORRECTED IN BOTH DIRECTIONS, NOT DELETED — DECISION 167/13.
   *
   * This asserted that «neither scope» was a 400, and it was right about the route as it stood. The
   * reason that route gave was *«a book-wide invoice list is the Process 33 ageing report»*, and
   * measured 2026-11-28 that report is one row per CUSTOMER with an invoice COUNT and no invoice id
   * — so it could not be the surface a finance officer uses to find the invoice they are collecting
   * on. The refusal answered a REPORTING question; decision 167/13 asks an OPERATIONAL one.
   *
   * ⟶ So what is asserted now is that the branch ANSWERS, and the refusal that REMAINS is the one
   *   that was always the real ambiguity: both scopes at once. The full behaviour of the new branch
   *   is in its own describe block at the end of this file.
   */
  it("ANSWERS with neither scope now — the office's list (decision 167/13)", async () => {
    const page = await deps.service.list({});
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('⛔ but still 400s on BOTH scopes, which is two different questions', async () => {
    await expect(
      deps.service.list({ policyId: 'pol-1', customerId: 'cust-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists by policyId', async () => {
    deps.invoices.findManyByPolicyId.mockResolvedValueOnce([
      {
        id: 'inv-1',
        policyId: 'pol-1',
        customerId: 'cust-1',
        invoiceType: 'new_business_premium',
        premiumAmount: d('1000'),
        taxAmount: d('0'),
        feesAmount: d('0'),
        commissionDeducted: d('125'),
        totalAmount: d('875'),
        currency: 'JOD',
        dueDate: new Date('2026-10-01T00:00:00.000Z'),
        status: 'INVOICED',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
      },
    ]);
    /*
     * ⚠️ THE ENVELOPE — corrected with decision 167/13. This read `rows.toHaveLength(1)` against a
     * bare array; every branch of the route now answers in ONE shape (`/policies`' own rule), so a
     * caller never has to ask which it got. The figure asserted is unchanged.
     */
    const page = await deps.service.list({ policyId: 'pol-1' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.totalAmount).toBe('875.000');
    expect(page.total).toBe(1);
    expect(deps.invoices.findManyByCustomerId).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 DECISION 167/13 — `GET /invoices` ANSWERS THE OFFICE'S LIST, AND THE OLD REFUSAL'S REASON
 * WAS MEASURED BEFORE IT WAS REMOVED.
 *
 * It 400'd on «neither scope» saying *«a book-wide invoice list is the Process 33 ageing report»*.
 * That report is one row per CUSTOMER with an invoice COUNT and no invoice id, so it cannot be the
 * surface a finance officer uses to find the invoice they are collecting on — which is the whole of
 * what decision 167/13 asks for.
 *
 * ⚠️ THESE ARE UNIT TESTS AND THEY ARE WHAT RUNS ON THE AUTHORING MACHINE. The api e2e cannot
 * run here (db-test `ibms_app` credentials), and #80 cost two red CI runs for exactly that reason.
 * So every claim about this branch that a unit test CAN make, it makes: the filter the repository is
 * called with, the envelope's shape, and the defaults.
 */
describe('InvoiceService.list — decision 167/13', () => {
  const listRow = (over: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    policyId: 'pol-1',
    customerId: 'cust-1',
    invoiceType: NEW_BUSINESS_PREMIUM_INVOICE_TYPE,
    premiumAmount: d('1000.000'),
    taxAmount: d('0.000'),
    feesAmount: d('0.000'),
    commissionDeducted: d('100.000'),
    totalAmount: d('1000.000'),
    currency: 'JOD',
    dueDate: new Date('2026-12-31T00:00:00.000Z'),
    status: 'INVOICED' as const,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    receipts: [],
    customer: { id: 'cust-1', legalName: 'Nasser Trading Co' },
    policy: {
      id: 'pol-1',
      policyNumber: 'POL-2026-0451',
      insurer: {
        id: 'ins-1',
        legalName: 'Jordan Insurance Co',
        legalNameAr: null,
        insurerMaster: null,
        insuranceCompany: null,
      },
    },
    ...over,
  });

  it('⛔ REFUSES both scopes together, which is two questions', async () => {
    const { service } = makeDeps();
    await expect(
      service.list({ policyId: 'pol-1', customerId: 'cust-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ACCEPTS neither scope now, and asks the repository for the OPEN set by default', async () => {
    /*
     * THE BRANCH THAT USED TO 400. And `open` defaults to TRUE: the screen's purpose is the work
     * still outstanding, so a finance officer opening it sees what is collectable rather than every
     * invoice the office ever raised.
     */
    const { service, invoices } = makeDeps();
    const page = await service.list({});
    expect(invoices.findPageWithNames).toHaveBeenCalledWith(
      expect.objectContaining({ openOnly: true }),
    );
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('an explicit open=false asks for everything — the flag is read, not assumed', async () => {
    // NON-VACUITY for the test above: without this, `openOnly` could be hard-coded `true` and the
    // default assertion would still pass.
    const { service, invoices } = makeDeps();
    await service.list({ open: 'false' });
    expect(invoices.findPageWithNames).toHaveBeenCalledWith(
      expect.objectContaining({ openOnly: false }),
    );
  });

  it('passes the insurer and the search through to the query, never filtering after the read', async () => {
    /*
     * ⛔ THE FILTER IS WHAT DECIDES VISIBILITY, NEVER THE PAGE SIZE — the recorded
     * `DpoWorkspaceService` defect. Asserted by what the repository is CALLED WITH: a service that
     * fetched a page and then filtered it would pass neither of these.
     */
    const { service, invoices } = makeDeps();
    await service.list({ insurerId: 'ins-9', search: 'POL-2026' });
    expect(invoices.findPageWithNames).toHaveBeenCalledWith(
      expect.objectContaining({ insurerId: 'ins-9', search: 'POL-2026' }),
    );
  });

  it('returns the page the repository reported, with its own total', async () => {
    // `total` comes from the repository's count over the SAME `where`, so a screen's page control
    // cannot promise pages that do not exist.
    const { service, invoices } = makeDeps();
    invoices.findPageWithNames.mockResolvedValue({
      rows: [listRow()],
      total: 137,
    });
    const page = await service.list({ page: 2, pageSize: 10 });
    expect(page.total).toBe(137);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(10);
    expect(invoices.findPageWithNames).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it('every row NAMES its customer, policy and insurer — no uuid is the display value', async () => {
    const { service, invoices } = makeDeps();
    invoices.findPageWithNames.mockResolvedValue({
      rows: [listRow()],
      total: 1,
    });
    const [row] = (await service.list({})).items as InvoiceListRowView[];
    expect(row.customerLegalName).toBe('Nasser Trading Co');
    expect(row.policyNumber).toBe('POL-2026-0451');
    expect(row.insurerName).toBe('Jordan Insurance Co');
    expect(row.insurerId).toBe('ins-1');
    // AND THE DERIVED MONEY IS STILL THERE — the list row EXTENDS `InvoiceView` rather than
    // replacing it, so no figure is re-derived for the table.
    expect(row.outstandingAmount).toBe('1000.000');
    expect(row.netRemittance).toBe('900.000');
  });

  it('an invoice with NO policy names no policy number and no insurer, rather than guessing', async () => {
    /*
     * `Invoice.policyId` is nullable in the schema, and such an invoice has no insurer to remit to
     * — which is what `recordRemittance` 422s on by name. ⟶ Three nulls, so the screen renders an
     * absence instead of an empty string that reads as a blank cell.
     */
    const { service, invoices } = makeDeps();
    invoices.findPageWithNames.mockResolvedValue({
      rows: [listRow({ policyId: null, policy: null })],
      total: 1,
    });
    const [row] = (await service.list({})).items as InvoiceListRowView[];
    expect(row.policyNumber).toBeNull();
    expect(row.insurerId).toBeNull();
    expect(row.insurerName).toBeNull();
    expect(row.insurerNameAr).toBeNull();
    // NON-VACUOUS: the customer is still named, so the row is not simply empty.
    expect(row.customerLegalName).toBe('Nasser Trading Co');
  });

  it('the two SCOPED branches still return every row they have, in the same envelope', async () => {
    /*
     * `FinanceSection` reads `?policyId=` and these branches are bounded by construction, so they
     * answer `wholeSet` — ONE shape for every branch of the route, which is `/policies`' own rule.
     * ⛔ And they are NOT given the display joins: widening them would add three joins to a read
     * that renders none of them.
     */
    const { service, invoices } = makeDeps();
    invoices.findManyByPolicyId.mockResolvedValue([
      { ...listRow(), customer: undefined, policy: undefined },
    ]);
    const page = await service.list({ policyId: 'pol-1' });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
    expect(invoices.findPageWithNames).not.toHaveBeenCalled();
    // The scoped row carries no display name, which is the point of the second view.
    expect(
      (page.items[0] as unknown as Record<string, unknown>).customerLegalName,
    ).toBeUndefined();
  });

  it('⛔ and OPEN_INVOICE_STATUSES is every status but REMITTED', () => {
    /*
     * The set is a REPOSITORY fact so the query and a screen cannot disagree about what «open»
     * means. Asserted against the Prisma enum itself rather than against a written-out list, so a
     * seventh status added next year fails here instead of silently dropping out of «open».
     *
     * ⚠️ The two EXCEPTION states ARE open: a variance put the invoice there, which is work
     * outstanding rather than work finished.
     */
    expect([...OPEN_INVOICE_STATUSES].sort()).toEqual(
      Object.values(InvoiceStatus)
        .filter((status) => status !== 'REMITTED')
        .sort(),
    );
  });
});
