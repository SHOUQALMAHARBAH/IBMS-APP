import { Prisma } from '@ibms/db';
import { describe, expect, it } from 'vitest';
import {
  ageingBucketFor,
  buildCommissionRollup,
  buildInsurerPayables,
  buildProfitability,
  buildReceivablesAgeing,
  computeInvoiceFigures,
  computeRemittanceAmount,
  computeVariance,
  daysOverdue,
  derivePaymentChannelView,
  deriveInvoiceView,
  deriveReconExceptionView,
  invoiceAuditSnapshot,
  invoiceFiguresMatch,
  isReconExceptionTransition,
  NEW_BUSINESS_PREMIUM_INVOICE_TYPE,
  paymentChannelAuditSnapshot,
  reconExceptionAuditSnapshot,
  reconExceptionUpdateAuditSnapshot,
  type CommissionRollupEntryRow,
  type InsurerObligationRow,
  type InsurerRemittanceRow,
  type InvoiceRow,
  type OutstandingInvoiceRow,
  type PaymentChannelRow,
  type ProfitabilityPolicyRow,
  type ReconExceptionRow,
} from './finance.config';

const d = (v: string) => new Prisma.Decimal(v);

describe('computeInvoiceFigures (Process 31)', () => {
  it('derives commission from the rate and totals premium + tax + fees - commission', () => {
    const f = computeInvoiceFigures({
      premiumAmount: '1000.000',
      commissionRatePercent: '12.5',
      taxAmount: '160.000',
      feesAmount: '25.000',
    });
    expect(f.premiumAmount.toFixed(3)).toBe('1000.000');
    expect(f.commissionDeducted.toFixed(3)).toBe('125.000'); // 1000 * 12.5%
    expect(f.taxAmount.toFixed(3)).toBe('160.000');
    expect(f.feesAmount.toFixed(3)).toBe('25.000');
    // 1000 + 160 + 25 - 125
    expect(f.totalAmount.toFixed(3)).toBe('1060.000');
  });

  it('defaults fees / tax to zero contributions and still nets the commission', () => {
    const f = computeInvoiceFigures({
      premiumAmount: '2500.500',
      commissionRatePercent: '15',
      taxAmount: '0',
      feesAmount: '0',
    });
    expect(f.commissionDeducted.toFixed(3)).toBe('375.075'); // 2500.5 * 15%
    expect(f.totalAmount.toFixed(3)).toBe('2125.425'); // 2500.5 - 375.075
  });

  it('quantizes the commission half-up at the third decimal place', () => {
    // 333.335 * 12.5% = 41.666875 -> HALF_UP at 3dp -> 41.667
    const f = computeInvoiceFigures({
      premiumAmount: '333.335',
      commissionRatePercent: '12.5',
      taxAmount: '0',
      feesAmount: '0',
    });
    expect(f.commissionDeducted.toFixed(3)).toBe('41.667');
    expect(f.totalAmount.toFixed(3)).toBe('291.668'); // 333.335 - 41.667
  });

  it('a zero commission rate leaves the total gross', () => {
    const f = computeInvoiceFigures({
      premiumAmount: '900.000',
      commissionRatePercent: '0',
      taxAmount: '50.000',
      feesAmount: '10.000',
    });
    expect(f.commissionDeducted.toFixed(3)).toBe('0.000');
    expect(f.totalAmount.toFixed(3)).toBe('960.000');
  });
});

describe('invoiceFiguresMatch', () => {
  const base = {
    premiumAmount: d('1000.000'),
    taxAmount: d('160.000'),
    feesAmount: d('25.000'),
    commissionDeducted: d('125.000'),
    totalAmount: d('1060.000'),
    dueDate: new Date('2026-10-01T00:00:00.000Z'),
  };

  it('is true for byte-identical figures + due date', () => {
    expect(invoiceFiguresMatch(base, { ...base })).toBe(true);
  });

  it('is false when any figure differs', () => {
    expect(
      invoiceFiguresMatch(base, { ...base, feesAmount: d('30.000') }),
    ).toBe(false);
  });

  it('is false when only the due date differs', () => {
    expect(
      invoiceFiguresMatch(base, {
        ...base,
        dueDate: new Date('2026-10-02T00:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('treats differently-scaled equal amounts as equal', () => {
    expect(
      invoiceFiguresMatch(
        { ...base, premiumAmount: d('1000') },
        { ...base, premiumAmount: d('1000.000') },
      ),
    ).toBe(true);
  });
});

describe('deriveInvoiceView', () => {
  const row: InvoiceRow = {
    id: 'inv-1',
    policyId: 'pol-1',
    customerId: 'cust-1',
    invoiceType: NEW_BUSINESS_PREMIUM_INVOICE_TYPE,
    premiumAmount: d('1000'),
    taxAmount: d('160'),
    feesAmount: d('25'),
    commissionDeducted: d('125'),
    totalAmount: d('1060'),
    currency: 'JOD',
    dueDate: new Date('2026-10-01T00:00:00.000Z'),
    status: 'INVOICED',
    createdAt: new Date('2026-09-02T10:00:00.000Z'),
  };

  it('renders every money field as a fixed 3dp string and the dates as ISO; no receipt / remittance yet', () => {
    const v = deriveInvoiceView(row);
    expect(v).toEqual({
      id: 'inv-1',
      policyId: 'pol-1',
      customerId: 'cust-1',
      invoiceType: 'new_business_premium',
      premiumAmount: '1000.000',
      taxAmount: '160.000',
      feesAmount: '25.000',
      commissionDeducted: '125.000',
      totalAmount: '1060.000',
      currency: 'JOD',
      dueDate: '2026-10-01T00:00:00.000Z',
      status: 'INVOICED',
      createdAt: '2026-09-02T10:00:00.000Z',
      netRemittance: '875.000', // 1000 premium − 125 commission
      receipt: null,
      remittance: null,
    });
  });

  it('surfaces the collection receipt and its remittance once present (Process 32)', () => {
    const v = deriveInvoiceView({
      ...row,
      status: 'REMITTED',
      receipts: [
        {
          id: 'rcpt-1',
          amount: d('1060'),
          method: 'bank_transfer',
          paymentChannelId: 'pc-cust-1',
          receivedAt: new Date('2026-10-03T09:00:00.000Z'),
          remittance: {
            id: 'rem-1',
            amount: d('875'),
            insurerId: 'ins-1',
            paymentChannelId: 'pc-ins-1',
            remittedAt: new Date('2026-10-05T12:00:00.000Z'),
          },
        },
      ],
    });
    expect(v.receipt).toEqual({
      id: 'rcpt-1',
      amount: '1060.000',
      method: 'bank_transfer',
      paymentChannelId: 'pc-cust-1',
      receivedAt: '2026-10-03T09:00:00.000Z',
    });
    expect(v.remittance).toEqual({
      id: 'rem-1',
      amount: '875.000',
      insurerId: 'ins-1',
      paymentChannelId: 'pc-ins-1',
      remittedAt: '2026-10-05T12:00:00.000Z',
    });
  });

  it('a receipt with no remittance yet leaves remittance null', () => {
    const v = deriveInvoiceView({
      ...row,
      status: 'COLLECTED',
      receipts: [
        {
          id: 'rcpt-1',
          amount: d('1060'),
          method: null,
          paymentChannelId: null,
          receivedAt: new Date('2026-10-03T09:00:00.000Z'),
          remittance: null,
        },
      ],
    });
    expect(v.receipt?.method).toBeNull();
    expect(v.receipt?.paymentChannelId).toBeNull();
    expect(v.remittance).toBeNull();
  });
});

describe('computeRemittanceAmount (Process 32)', () => {
  it('is premium minus commission', () => {
    expect(computeRemittanceAmount('120000.000', '14400.000').toFixed(3)).toBe(
      '105600.000',
    );
  });

  it('quantizes to fils and is scale-insensitive on the inputs', () => {
    expect(computeRemittanceAmount(d('1000'), d('125.0')).toFixed(3)).toBe(
      '875.000',
    );
  });

  it('is exactly zero when commission equals the premium', () => {
    expect(computeRemittanceAmount('1000.000', '1000.000').toFixed(3)).toBe(
      '0.000',
    );
  });
});

describe('daysOverdue / ageingBucketFor (Process 33)', () => {
  const asOf = new Date('2026-09-03T00:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;
  const due = (offsetDays: number) =>
    new Date(Date.UTC(2026, 8, 3) + offsetDays * DAY);

  it('counts whole calendar days past the reference date, negative when not yet due', () => {
    expect(daysOverdue(due(0), asOf)).toBe(0); // due exactly today
    expect(daysOverdue(due(-1), asOf)).toBe(1);
    expect(daysOverdue(due(-45), asOf)).toBe(45);
    expect(daysOverdue(due(10), asOf)).toBe(-10); // due in 10 days
  });

  it('ignores the wall-clock time the reference instant carries', () => {
    const asOfLate = new Date('2026-09-03T23:30:00.000Z');
    expect(daysOverdue(due(-1), asOfLate)).toBe(1);
  });

  it('maps a days-overdue count to the 30 / 60 / 90 bucket', () => {
    expect(ageingBucketFor(-10)).toBe('current');
    expect(ageingBucketFor(0)).toBe('current');
    expect(ageingBucketFor(1)).toBe('d1_30');
    expect(ageingBucketFor(30)).toBe('d1_30');
    expect(ageingBucketFor(31)).toBe('d31_60');
    expect(ageingBucketFor(60)).toBe('d31_60');
    expect(ageingBucketFor(61)).toBe('d61_90');
    expect(ageingBucketFor(90)).toBe('d61_90');
    expect(ageingBucketFor(91)).toBe('d90_plus');
  });
});

describe('buildReceivablesAgeing (Process 33)', () => {
  const asOf = new Date('2026-09-03T00:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;
  const due = (offsetDays: number) =>
    new Date(Date.UTC(2026, 8, 3) + offsetDays * DAY);

  const inv = (
    over: Partial<OutstandingInvoiceRow> &
      Pick<
        OutstandingInvoiceRow,
        'id' | 'customerId' | 'totalAmount' | 'dueDate'
      >,
  ): OutstandingInvoiceRow => ({
    customerLegalName: `Cust ${over.customerId}`,
    currency: 'JOD',
    ...over,
  });

  it('groups by customer, buckets each invoice, and pools the totals', () => {
    const report = buildReceivablesAgeing({
      asOf,
      invoices: [
        inv({
          id: 'a1',
          customerId: 'A',
          totalAmount: '1000.000',
          dueDate: due(-91),
        }),
        inv({
          id: 'a2',
          customerId: 'A',
          totalAmount: '500.000',
          dueDate: due(5),
        }),
        inv({
          id: 'b1',
          customerId: 'B',
          totalAmount: '2000.000',
          dueDate: due(-5),
        }),
      ],
    });

    expect(report.asOf).toBe('2026-09-03T00:00:00.000Z');
    expect(report.currency).toBe('JOD');

    // worst-first: A (91 days overdue) before B (5 days)
    expect(report.rows.map((r) => r.customerId)).toEqual(['A', 'B']);

    const a = report.rows[0];
    expect(a).toMatchObject({
      customerId: 'A',
      current: '500.000',
      d1_30: '0.000',
      d31_60: '0.000',
      d61_90: '0.000',
      d90_plus: '1000.000',
      outstandingTotal: '1500.000',
      invoiceCount: 2,
      oldestDaysOverdue: 91,
      oldestDueDate: due(-91).toISOString(),
    });

    expect(report.rows[1]).toMatchObject({
      customerId: 'B',
      d1_30: '2000.000',
      outstandingTotal: '2000.000',
      invoiceCount: 1,
      oldestDaysOverdue: 5,
    });

    expect(report.totals).toEqual({
      current: '500.000',
      d1_30: '2000.000',
      d31_60: '0.000',
      d61_90: '0.000',
      d90_plus: '1000.000',
      outstandingTotal: '3500.000',
      invoiceCount: 3,
      customerCount: 2,
    });
  });

  it('breaks an equal-age tie by outstanding balance, then by name', () => {
    const report = buildReceivablesAgeing({
      asOf,
      invoices: [
        inv({
          id: 'c',
          customerId: 'C',
          totalAmount: '1000.000',
          dueDate: due(-10),
        }),
        inv({
          id: 'd',
          customerId: 'D',
          totalAmount: '3000.000',
          dueDate: due(-10),
        }),
        inv({
          id: 'e',
          customerId: 'E',
          totalAmount: '3000.000',
          dueDate: due(-10),
        }),
      ],
    });
    // same age → larger balance first (D, E), then name asc among equal balances
    expect(report.rows.map((r) => r.customerId)).toEqual(['D', 'E', 'C']);
  });

  it('is empty (zeroed totals) when nothing is outstanding', () => {
    const report = buildReceivablesAgeing({ asOf, invoices: [] });
    expect(report.rows).toEqual([]);
    expect(report.totals).toEqual({
      current: '0.000',
      d1_30: '0.000',
      d31_60: '0.000',
      d61_90: '0.000',
      d90_plus: '0.000',
      outstandingTotal: '0.000',
      invoiceCount: 0,
      customerCount: 0,
    });
  });

  it('normalises the asOf output to UTC midnight', () => {
    const report = buildReceivablesAgeing({
      asOf: new Date('2026-09-03T14:22:00.000Z'),
      invoices: [],
    });
    expect(report.asOf).toBe('2026-09-03T00:00:00.000Z');
  });
});

describe('buildInsurerPayables (Process 34)', () => {
  const asOf = new Date('2026-09-03T00:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;
  const collected = (offsetDays: number) =>
    new Date(Date.UTC(2026, 8, 3) + offsetDays * DAY);

  const obl = (
    over: Partial<InsurerObligationRow> &
      Pick<
        InsurerObligationRow,
        | 'invoiceId'
        | 'insurerId'
        | 'premiumAmount'
        | 'commissionDeducted'
        | 'collectedAt'
      >,
  ): InsurerObligationRow => ({
    insurerName: `Insurer ${over.insurerId}`,
    ...over,
  });

  const rem = (
    over: Partial<InsurerRemittanceRow> &
      Pick<
        InsurerRemittanceRow,
        'remittanceId' | 'insurerId' | 'amount' | 'remittedAt'
      >,
  ): InsurerRemittanceRow => ({
    insurerName: `Insurer ${over.insurerId}`,
    ...over,
  });

  it('groups by insurer, derives the net owed (premium - commission), and pools both sides', () => {
    const report = buildInsurerPayables({
      asOf,
      obligations: [
        obl({
          invoiceId: 'a1',
          insurerId: 'A',
          premiumAmount: '100000.000',
          commissionDeducted: '12000.000',
          collectedAt: collected(-40),
        }),
        obl({
          invoiceId: 'a2',
          insurerId: 'A',
          premiumAmount: '50000.000',
          commissionDeducted: '6000.000',
          collectedAt: collected(-5),
        }),
      ],
      remittances: [
        rem({
          remittanceId: 'ra',
          insurerId: 'A',
          amount: '30000.000',
          remittedAt: collected(-30),
        }),
        rem({
          remittanceId: 'rb',
          insurerId: 'B',
          amount: '10000.000',
          remittedAt: collected(-2),
        }),
      ],
    });

    expect(report.asOf).toBe('2026-09-03T00:00:00.000Z');
    expect(report.currency).toBe('JOD');
    // worst-first: A has a 40-day-old obligation, B has none outstanding
    expect(report.rows.map((r) => r.insurerId)).toEqual(['A', 'B']);

    expect(report.rows[0]).toMatchObject({
      insurerId: 'A',
      outstandingAmount: '132000.000', // 88000 + 44000
      outstandingCount: 2,
      oldestCollectedAt: collected(-40).toISOString(),
      oldestDaysOutstanding: 40,
      remittedAmount: '30000.000',
      remittedCount: 1,
    });
    expect(report.rows[1]).toMatchObject({
      insurerId: 'B',
      outstandingAmount: '0.000',
      outstandingCount: 0,
      oldestCollectedAt: null,
      oldestDaysOutstanding: -1,
      remittedAmount: '10000.000',
      remittedCount: 1,
    });

    expect(report.totals).toEqual({
      outstandingAmount: '132000.000',
      outstandingCount: 2,
      remittedAmount: '40000.000',
      remittedCount: 2,
      insurerCount: 2,
    });
  });

  it('computes the net owed through money.util (quantized), never re-typed', () => {
    const report = buildInsurerPayables({
      asOf,
      obligations: [
        obl({
          invoiceId: 'x',
          insurerId: 'X',
          premiumAmount: '1000.000',
          commissionDeducted: '125.5',
          collectedAt: collected(-1),
        }),
      ],
      remittances: [],
    });
    expect(report.rows[0]?.outstandingAmount).toBe('874.500'); // 1000 - 125.5
  });

  it('breaks an equal-age tie by amount owed, then by insurer name', () => {
    const report = buildInsurerPayables({
      asOf,
      obligations: [
        // Z: same age + same amount as X -> falls through to the name tie-break
        obl({
          invoiceId: 'z',
          insurerId: 'Z',
          premiumAmount: '1000.000',
          commissionDeducted: '0.000',
          collectedAt: collected(-10),
        }),
        obl({
          invoiceId: 'x',
          insurerId: 'X',
          premiumAmount: '1000.000',
          commissionDeducted: '0.000',
          collectedAt: collected(-10),
        }),
        obl({
          invoiceId: 'd',
          insurerId: 'D',
          premiumAmount: '3000.000',
          commissionDeducted: '0.000',
          collectedAt: collected(-10),
        }),
      ],
      remittances: [],
    });
    // D first (larger amount), then X before Z (equal age + amount -> name asc)
    expect(report.rows.map((r) => r.insurerId)).toEqual(['D', 'X', 'Z']);
  });

  it('is empty (zeroed totals) when nothing is owed or remitted', () => {
    const report = buildInsurerPayables({
      asOf,
      obligations: [],
      remittances: [],
    });
    expect(report.rows).toEqual([]);
    expect(report.totals).toEqual({
      outstandingAmount: '0.000',
      outstandingCount: 0,
      remittedAmount: '0.000',
      remittedCount: 0,
      insurerCount: 0,
    });
  });

  it('normalises the asOf output to UTC midnight', () => {
    const report = buildInsurerPayables({
      asOf: new Date('2026-09-03T14:22:00.000Z'),
      obligations: [],
      remittances: [],
    });
    expect(report.asOf).toBe('2026-09-03T00:00:00.000Z');
  });
});

describe('invoiceAuditSnapshot', () => {
  it('carries ids + money as fixed strings + the rate applied, no free text', () => {
    const snap = invoiceAuditSnapshot({
      invoiceId: 'inv-1',
      policyId: 'pol-1',
      customerId: 'cust-1',
      invoiceType: 'new_business_premium',
      premiumAmount: d('1000'),
      taxAmount: d('160'),
      feesAmount: d('25'),
      commissionDeducted: d('125'),
      totalAmount: d('1060'),
      commissionRatePercent: '12.50',
      currency: 'JOD',
      dueDate: new Date('2026-10-01T00:00:00.000Z'),
      status: 'INVOICED',
    });
    expect(snap).toMatchObject({
      invoiceId: 'inv-1',
      policyId: 'pol-1',
      premiumAmount: '1000.000',
      commissionDeducted: '125.000',
      totalAmount: '1060.000',
      commissionRatePercent: '12.50',
      dueDate: '2026-10-01T00:00:00.000Z',
      status: 'INVOICED',
    });
  });
});

describe('PaymentChannel view + audit (Process 38)', () => {
  const base: PaymentChannelRow = {
    id: 'pc-1',
    ownerType: 'customer',
    customerId: 'cust-1',
    insurerId: null,
    channelType: 'bank_transfer',
    label: 'Primary JOD',
    bankName: 'Cairo Amman Bank',
    accountLast4: '1234',
    currency: 'JOD',
    status: 'active',
    disabledAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };

  it('derivePaymentChannelView renders isActive + ISO dates + the masked fragment', () => {
    expect(derivePaymentChannelView(base)).toEqual({
      id: 'pc-1',
      ownerType: 'customer',
      customerId: 'cust-1',
      insurerId: null,
      channelType: 'bank_transfer',
      label: 'Primary JOD',
      bankName: 'Cairo Amman Bank',
      accountLast4: '1234',
      currency: 'JOD',
      status: 'active',
      isActive: true,
      disabledAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('a disabled channel is not active', () => {
    const v = derivePaymentChannelView({
      ...base,
      status: 'disabled',
      disabledAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    expect(v.isActive).toBe(false);
    expect(v.disabledAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('paymentChannelAuditSnapshot carries metadata but NEVER accountLast4', () => {
    const snap = paymentChannelAuditSnapshot({
      channelId: 'pc-1',
      ownerType: 'insurer',
      customerId: null,
      insurerId: 'ins-1',
      channelType: 'cheque',
      label: 'Insurer settlement account',
      bankName: 'Arab Bank',
      status: 'active',
    });
    expect(snap).toEqual({
      channelId: 'pc-1',
      ownerType: 'insurer',
      customerId: null,
      insurerId: 'ins-1',
      channelType: 'cheque',
      label: 'Insurer settlement account',
      bankName: 'Arab Bank',
      status: 'active',
    });
    expect(JSON.stringify(snap)).not.toContain('1234');
    expect(Object.keys(snap)).not.toContain('accountLast4');
  });
});

describe('computeVariance (Process 39)', () => {
  it('is insurerStatementAmount − brokerRecordAmount, exact to the fils', () => {
    // the money-decimal-jod.md example: statement 100000, broker 95000
    expect(computeVariance('100000.000', '95000.000').toFixed(3)).toBe(
      '5000.000',
    );
  });
  it('is negative when the insurer says less than the broker recorded', () => {
    expect(computeVariance('95000.000', '100000.000').toFixed(3)).toBe(
      '-5000.000',
    );
  });
  it('is exactly zero (not rounded away) when the figures agree', () => {
    expect(computeVariance('105600.000', '105600.000').toFixed(3)).toBe(
      '0.000',
    );
  });
  it('keeps a sub-fils-looking variance at full precision', () => {
    expect(computeVariance('105600.001', '105600.000').toFixed(3)).toBe(
      '0.001',
    );
  });
});

describe('isReconExceptionTransition (Process 39)', () => {
  it('allows open -> investigating | resolved and investigating -> resolved', () => {
    expect(isReconExceptionTransition('open', 'investigating')).toBe(true);
    expect(isReconExceptionTransition('open', 'resolved')).toBe(true);
    expect(isReconExceptionTransition('investigating', 'resolved')).toBe(true);
  });
  it('rejects resolved -> anything, investigating -> open, and an unknown from', () => {
    expect(isReconExceptionTransition('resolved', 'investigating')).toBe(false);
    expect(isReconExceptionTransition('resolved', 'resolved')).toBe(false);
    expect(isReconExceptionTransition('investigating', 'investigating')).toBe(
      false,
    );
    expect(isReconExceptionTransition('nonsense', 'resolved')).toBe(false);
  });
});

describe('ReconciliationException view + audit (Process 39)', () => {
  const base: ReconExceptionRow = {
    id: 're-1',
    invoiceId: 'inv-1',
    insurerStatementAmount: d('100000'),
    brokerRecordAmount: d('95000'),
    varianceAmount: d('5000'),
    status: 'open',
    raisedByUserId: 'fin-1',
    investigatedByUserId: null,
    resolvedByUserId: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date('2026-09-03T10:00:00.000Z'),
  };

  it('deriveReconExceptionView renders the three figures + isResolved + ISO dates', () => {
    expect(deriveReconExceptionView(base)).toEqual({
      id: 're-1',
      invoiceId: 'inv-1',
      insurerStatementAmount: '100000.000',
      brokerRecordAmount: '95000.000',
      varianceAmount: '5000.000',
      status: 'open',
      isResolved: false,
      raisedByUserId: 'fin-1',
      investigatedByUserId: null,
      resolvedByUserId: null,
      resolutionNote: null,
      resolvedAt: null,
      createdAt: '2026-09-03T10:00:00.000Z',
    });
  });

  it('a resolved exception surfaces isResolved + the note + resolvedAt', () => {
    const v = deriveReconExceptionView({
      ...base,
      status: 'resolved',
      resolvedByUserId: 'mgr-1',
      resolutionNote:
        'Insurer applied an FX rate we had not; broker figure stands.',
      resolvedAt: new Date('2026-09-10T00:00:00.000Z'),
    });
    expect(v.isResolved).toBe(true);
    expect(v.resolutionNote).toContain('FX rate');
    expect(v.resolvedAt).toBe('2026-09-10T00:00:00.000Z');
  });

  it('reconExceptionAuditSnapshot carries the three figures as fixed strings, no free text', () => {
    expect(
      reconExceptionAuditSnapshot({
        exceptionId: 're-1',
        invoiceId: 'inv-1',
        insurerStatementAmount: d('100000'),
        brokerRecordAmount: d('95000'),
        varianceAmount: d('5000'),
        status: 'open',
      }),
    ).toEqual({
      exceptionId: 're-1',
      invoiceId: 'inv-1',
      insurerStatementAmount: '100000.000',
      brokerRecordAmount: '95000.000',
      varianceAmount: '5000.000',
      status: 'open',
    });
  });

  it('reconExceptionUpdateAuditSnapshot carries the resolutionNote verbatim', () => {
    const snap = reconExceptionUpdateAuditSnapshot({
      exceptionId: 're-1',
      invoiceId: 'inv-1',
      varianceAmount: d('5000'),
      status: 'resolved',
      investigatedByUserId: 'fin-1',
      resolvedByUserId: 'mgr-1',
      resolutionNote: 'Statement double-counted a prior remittance.',
      resumeInvoiceAs: 'REMITTED',
    });
    expect(snap).toMatchObject({
      varianceAmount: '5000.000',
      status: 'resolved',
      resolutionNote: 'Statement double-counted a prior remittance.',
      resumeInvoiceAs: 'REMITTED',
    });
  });
});

describe('buildCommissionRollup (Process 40)', () => {
  const entry = (
    over: Partial<CommissionRollupEntryRow> = {},
  ): CommissionRollupEntryRow => ({
    entryId: 'cle-1',
    insurerId: 'ins-1',
    insurerName: 'Alpha Insurance',
    amount: d('1000.000'),
    vatAmount: d('160.000'),
    paidAmount: null,
    reversedAmount: null,
    status: 'outstanding',
    ...over,
  });

  it('an outstanding entry contributes its full amount to earned + outstanding', () => {
    const r = buildCommissionRollup([entry()]);
    expect(r.earned).toBe('1000.000');
    expect(r.paid).toBe('0.000');
    expect(r.reversed).toBe('0.000');
    expect(r.outstanding).toBe('1000.000');
    expect(r.vat).toBe('160.000');
    expect(r.gross).toBe('1160.000');
    expect(r.entryCount).toBe(1);
  });

  it('earned == paid + outstanding + reversed across a book with no paid+reversed overlap', () => {
    const r = buildCommissionRollup([
      entry({ entryId: 'a', status: 'outstanding' }), // 1000 outstanding
      entry({
        entryId: 'b',
        status: 'paid',
        amount: d('2000.000'),
        paidAmount: d('2000.000'),
      }), // 2000 paid
      entry({
        entryId: 'c',
        status: 'reversed',
        amount: d('500.000'),
        reversedAmount: d('500.000'),
      }), // 500 reversed (was outstanding)
      entry({
        entryId: 'd',
        status: 'outstanding',
        amount: d('900.000'),
        reversedAmount: d('300.000'),
      }), // 600 still collectible
    ]);
    expect(r.earned).toBe('4400.000'); // 1000 + 2000 + 500 + 900
    expect(r.paid).toBe('2000.000');
    expect(r.reversed).toBe('800.000'); // 500 + 300
    expect(r.outstanding).toBe('1600.000'); // 1000 + 0 + 0 + 600
    expect(r.netEarned).toBe('3600.000'); // 4400 − 800
    // the invariant holds when no entry is both paid and reversed
    expect(
      new Prisma.Decimal(r.paid)
        .plus(r.outstanding)
        .plus(r.reversed)
        .toFixed(3),
    ).toBe(r.earned);
  });

  it('a reconciled-then-clawed-back entry never drives outstanding negative', () => {
    const r = buildCommissionRollup([
      // #36 settle stamps paidAmount == amount; a later Process 22 cancellation
      // claws back part of it while status is still `paid`
      entry({
        entryId: 'paid-partial-clawback',
        status: 'paid',
        amount: d('1000.000'),
        paidAmount: d('1000.000'),
        reversedAmount: d('300.000'),
      }),
      // fully clawed back after payment → status `reversed`, paidAmount kept
      entry({
        entryId: 'paid-full-clawback',
        insurerId: 'ins-2',
        insurerName: 'Beta',
        status: 'reversed',
        amount: d('2000.000'),
        paidAmount: d('2000.000'),
        reversedAmount: d('2000.000'),
      }),
      entry({ entryId: 'plain', amount: d('500.000') }), // 500 genuinely outstanding
    ]);
    // outstanding floored at 0 per entry — the 500 is NOT eaten by the two
    // paid+reversed entries' would-be negatives
    expect(r.outstanding).toBe('500.000');
    expect(Number(r.outstanding)).toBeGreaterThanOrEqual(0);
    for (const row of r.byInsurer) {
      expect(Number(row.outstanding)).toBeGreaterThanOrEqual(0);
    }
    // the genuinely-outstanding insurer sorts ahead of the two zeroed rows
    expect(r.byInsurer[0]?.outstanding).toBe('500.000');
    expect(r.paid).toBe('3000.000'); // 1000 + 2000
    expect(r.reversed).toBe('2300.000'); // 300 + 2000
    expect(r.netEarned).toBe('1200.000'); // 3500 earned − 2300 reversed
  });

  it('groups by insurer and orders rows worst-first (largest outstanding, then earned, then name)', () => {
    const r = buildCommissionRollup([
      entry({
        entryId: 'a',
        insurerId: 'ins-a',
        insurerName: 'Zeta',
        amount: d('100.000'),
      }),
      entry({
        entryId: 'b',
        insurerId: 'ins-b',
        insurerName: 'Beta',
        amount: d('900.000'),
      }),
      entry({
        entryId: 'c',
        insurerId: 'ins-b',
        insurerName: 'Beta',
        amount: d('100.000'),
      }),
    ]);
    expect(r.byInsurer.map((x) => x.insurerId)).toEqual(['ins-b', 'ins-a']);
    expect(r.byInsurer[0]?.outstanding).toBe('1000.000');
    expect(r.byInsurer[0]?.entryCount).toBe(2);
  });

  it('is a clean zero for an empty book', () => {
    const r = buildCommissionRollup([]);
    expect(r).toMatchObject({
      earned: '0.000',
      vat: '0.000',
      gross: '0.000',
      paid: '0.000',
      reversed: '0.000',
      outstanding: '0.000',
      entryCount: 0,
      byInsurer: [],
    });
  });
});

describe('buildProfitability (Process 40)', () => {
  const pol = (
    over: Partial<ProfitabilityPolicyRow> = {},
  ): ProfitabilityPolicyRow => ({
    policyId: 'pol-1',
    insuranceLine: 'Property All Risks',
    customerType: 'CORPORATE',
    premium: d('120000.000'),
    claimNetSettlements: [],
    commissionAmount: d('14400.000'),
    commissionReversedAmount: null,
    ...over,
  });

  it('netPosition = premiumWritten - claimsPaid - commissionEarned per group', () => {
    const s = buildProfitability([
      pol({
        claimNetSettlements: [d('30000.000'), d('5000.000')],
        commissionAmount: d('14400.000'),
        commissionReversedAmount: d('400.000'), // net commission 14000
      }),
    ]);
    // 120000 - 35000 - 14000 = 71000
    expect(s.totals.premiumWritten).toBe('120000.000');
    expect(s.totals.claimsPaid).toBe('35000.000');
    expect(s.totals.commissionEarned).toBe('14000.000');
    expect(s.totals.netPosition).toBe('71000.000');
    expect(s.totals.policyCount).toBe(1);
    expect(s.totals.claimCount).toBe(2);
  });

  it('groups byLine and bySegment and sorts worst-first (most-negative netPosition)', () => {
    const s = buildProfitability([
      pol({
        policyId: 'a',
        insuranceLine: 'Motor Fleet',
        customerType: 'INDIVIDUAL',
        premium: d('10000.000'),
        claimNetSettlements: [d('90000.000')], // net -84400
        commissionAmount: d('1200.000'),
      }),
      pol({
        policyId: 'b',
        insuranceLine: 'Property All Risks',
        customerType: 'CORPORATE',
        premium: d('120000.000'),
        claimNetSettlements: [],
        commissionAmount: d('14400.000'), // net 105600
      }),
    ]);
    expect(s.byLine.map((r) => r.key)).toEqual([
      'Motor Fleet',
      'Property All Risks',
    ]);
    expect(s.byLine[0]?.netPosition).toBe('-81200.000'); // 10000 - 90000 - 1200
    expect(s.bySegment.map((r) => r.key)).toEqual(['INDIVIDUAL', 'CORPORATE']);
  });

  it('a null commission entry contributes zero commission', () => {
    const s = buildProfitability([
      pol({ commissionAmount: null, commissionReversedAmount: null }),
    ]);
    expect(s.totals.commissionEarned).toBe('0.000');
    expect(s.totals.netPosition).toBe('120000.000');
  });

  it('is a clean zero for an empty book', () => {
    const s = buildProfitability([]);
    expect(s.byLine).toEqual([]);
    expect(s.bySegment).toEqual([]);
    expect(s.totals).toMatchObject({
      premiumWritten: '0.000',
      claimsPaid: '0.000',
      commissionEarned: '0.000',
      netPosition: '0.000',
      policyCount: 0,
      claimCount: 0,
    });
  });
});
