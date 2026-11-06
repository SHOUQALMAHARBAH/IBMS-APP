import { describe, expect, it } from 'vitest';
import {
  buildInvoiceHtml,
  type InvoiceDocumentData,
} from './invoice-document.template';

const BASE_DATA: InvoiceDocumentData = {
  invoiceId: 'inv-123',
  customerLegalName: 'شركة الأفق للتأمين',
  policyNumber: 'POL-2026-001',
  insuranceLine: 'Property All Risks',
  insurerName: 'الاتحاد للتأمين',
  invoiceDate: new Date('2026-09-01T00:00:00Z'),
  dueDate: new Date('2026-10-01T00:00:00Z'),
  premiumAmount: { toString: () => '120000' },
  taxAmount: { toString: () => '9600' },
  feesAmount: { toString: () => '150' },
  totalAmount: { toString: () => '115350' },
  currency: 'JOD',
  receipts: [],
  bodyEn: 'This is your invoice for the insurance premium below.',
  bodyAr: 'هذه فاتورتكم لقسط التأمين المبيّن أدناه.',
};

describe('buildInvoiceHtml', () => {
  it('renders an AR-only document with dir="rtl"', () => {
    const html = buildInvoiceHtml(BASE_DATA, 'AR');
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('dir="ltr"');
    expect(html).toContain('هذه فاتورتكم لقسط التأمين المبيّن أدناه.');
    expect(html).not.toContain(
      'This is your invoice for the insurance premium below.',
    );
  });

  it('renders an EN-only document with dir="ltr"', () => {
    const html = buildInvoiceHtml(BASE_DATA, 'EN');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain('dir="rtl"');
    expect(html).toContain(
      'This is your invoice for the insurance premium below.',
    );
  });

  it("DUAL renders both sections, Arabic first (this system's primary language)", () => {
    const html = buildInvoiceHtml(BASE_DATA, 'DUAL');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('dir="ltr"');
    expect(html.indexOf('dir="rtl"')).toBeLessThan(html.indexOf('dir="ltr"'));
  });

  it('includes the invoice reference and policy number so a client can cite them back', () => {
    const html = buildInvoiceHtml(BASE_DATA, 'EN');
    expect(html).toContain('inv-123');
    expect(html).toContain('POL-2026-001');
  });

  it('includes the insurer, insurance line, dates, a client-facing status and the four money figures', () => {
    const html = buildInvoiceHtml(BASE_DATA, 'EN');
    expect(html).toContain('الاتحاد للتأمين');
    expect(html).toContain('Property All Risks');
    expect(html).toContain('Outstanding'); // no receipt yet
    expect(html).toContain('JOD 120,000.000'); // premium
    expect(html).toContain('JOD 9,600.000'); // tax
    expect(html).toContain('JOD 150.000'); // fees
    expect(html).toContain('JOD 115,350.000'); // total due
  });

  it('never renders the raw internal Invoice.status enum — only a client-facing Outstanding/Paid label derived from the receipt', () => {
    const html = buildInvoiceHtml(BASE_DATA, 'EN');
    for (const internalStatus of [
      'INVOICED',
      'COLLECTED',
      'RECONCILED',
      'REMITTED',
      'EXCEPTION_RAISED',
      'EXCEPTION_RESOLVED',
    ]) {
      expect(html).not.toContain(internalStatus);
    }
  });

  it('never renders the commission-deducted or net-remittance figures — a flagged content decision (AskUserQuestion-confirmed)', () => {
    const html = buildInvoiceHtml(BASE_DATA, 'DUAL');
    expect(html).not.toContain('commission');
    expect(html).not.toContain('Commission');
    expect(html).not.toContain('عمولة');
    expect(html).not.toContain('Remitted');
    expect(html).not.toContain('remittance');
  });

  it('renders an em dash for a null policy number / insurance line / insurer (an invoice with no linked policy)', () => {
    const html = buildInvoiceHtml(
      {
        ...BASE_DATA,
        policyNumber: null,
        insuranceLine: null,
        insurerName: null,
      },
      'EN',
    );
    expect(html).toContain('Policy Number');
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
  });

  it("renders the client's own collection receipt when one exists", () => {
    const html = buildInvoiceHtml(
      {
        ...BASE_DATA,
        receipts: [
          {
            amount: { toString: () => '115350' },
            method: 'bank_transfer',
            receivedAt: new Date('2026-09-15T00:00:00Z'),
          },
        ],
      },
      'EN',
    );
    expect(html).toContain('Payment Received');
    expect(html).toContain('JOD 115,350.000');
    expect(html).toContain('bank_transfer');
    // Still "Paid" — this instalment settles the whole 115,350 total, so the sum-based test and
    // the old existence test agree here. The two tests below are where they disagree.
    expect(html).toContain('Paid');
    expect(html).not.toContain('Outstanding');
  });

  /*
   * ROW 22 — added 2026-11-06 (module 0-c batch 6). These two are the behaviour change.
   *
   * `clientStatus` was `data.receipt ? 'Paid' : 'Outstanding'` — an EXISTENCE test over the first
   * instalment. On an invoice of 115,350 settled by a single 100 payment it printed "Paid", on the
   * client's own bill. It is a SUM against `totalAmount` now.
   */
  it('a PART-paid invoice is Outstanding, not Paid — the client is not told a balance is settled', () => {
    const html = buildInvoiceHtml(
      {
        ...BASE_DATA,
        receipts: [
          {
            amount: { toString: () => '100' },
            method: 'cash',
            receivedAt: new Date('2026-09-15T00:00:00Z'),
          },
        ],
      },
      'EN',
    );
    expect(html).toContain('Outstanding');
    expect(html).not.toContain('>Paid<');
    // The instalment itself is still shown — the client sees what they paid AND that a balance
    // remains, which is the pair of facts the old document could not express together.
    expect(html).toContain('JOD 100.000');
  });

  it('shows EVERY instalment and adds them up, rather than the first of several', () => {
    const html = buildInvoiceHtml(
      {
        ...BASE_DATA,
        receipts: [
          {
            amount: { toString: () => '15350' },
            method: 'cash',
            receivedAt: new Date('2026-09-15T00:00:00Z'),
          },
          {
            amount: { toString: () => '100000' },
            method: 'bank_transfer',
            receivedAt: new Date('2026-09-20T00:00:00Z'),
          },
        ],
      },
      'EN',
    );
    // Both instalments, both methods — the second was invisible before.
    expect(html).toContain('JOD 15,350.000');
    expect(html).toContain('JOD 100,000.000');
    expect(html).toContain('cash');
    expect(html).toContain('bank_transfer');
    // 15,350 + 100,000 = 115,350 = the total, so this one IS settled. The old code would have
    // called it settled on the strength of the 15,350 alone, which is the same answer reached by
    // luck rather than by arithmetic.
    expect(html).toContain('Paid');
  });

  it('renders no "Payment Received" section when no receipt exists yet, without crashing', () => {
    const html = buildInvoiceHtml(BASE_DATA, 'EN');
    expect(html).not.toContain('Payment Received');
  });

  it('escapes HTML-shaped content in the customer legal name instead of injecting it raw', () => {
    const html = buildInvoiceHtml(
      { ...BASE_DATA, customerLegalName: '<script>alert(1)</script>' },
      'EN',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('gracefully degrades a non-finite money value instead of crashing', () => {
    const html = buildInvoiceHtml(
      { ...BASE_DATA, feesAmount: { toString: () => 'n/a' } },
      'EN',
    );
    expect(html).toContain('JOD n/a');
  });
});
