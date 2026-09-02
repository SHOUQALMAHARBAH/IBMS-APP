import { Prisma } from '@ibms/db';
import { describe, expect, it } from 'vitest';
import {
  computeInvoiceFigures,
  deriveInvoiceView,
  invoiceAuditSnapshot,
  invoiceFiguresMatch,
  NEW_BUSINESS_PREMIUM_INVOICE_TYPE,
  type InvoiceRow,
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

  it('renders every money field as a fixed 3dp string and the dates as ISO', () => {
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
    });
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
