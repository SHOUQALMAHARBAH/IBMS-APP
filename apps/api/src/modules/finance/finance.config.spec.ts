import { Prisma } from '@ibms/db';
import { describe, expect, it } from 'vitest';
import {
  ageingBucketFor,
  buildInsurerPayables,
  buildReceivablesAgeing,
  computeInvoiceFigures,
  computeRemittanceAmount,
  daysOverdue,
  deriveInvoiceView,
  invoiceAuditSnapshot,
  invoiceFiguresMatch,
  NEW_BUSINESS_PREMIUM_INVOICE_TYPE,
  type InsurerObligationRow,
  type InsurerRemittanceRow,
  type InvoiceRow,
  type OutstandingInvoiceRow,
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
          receivedAt: new Date('2026-10-03T09:00:00.000Z'),
          remittance: {
            id: 'rem-1',
            amount: d('875'),
            insurerId: 'ins-1',
            remittedAt: new Date('2026-10-05T12:00:00.000Z'),
          },
        },
      ],
    });
    expect(v.receipt).toEqual({
      id: 'rcpt-1',
      amount: '1060.000',
      method: 'bank_transfer',
      receivedAt: '2026-10-03T09:00:00.000Z',
    });
    expect(v.remittance).toEqual({
      id: 'rem-1',
      amount: '875.000',
      insurerId: 'ins-1',
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
          receivedAt: new Date('2026-10-03T09:00:00.000Z'),
          remittance: null,
        },
      ],
    });
    expect(v.receipt?.method).toBeNull();
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
