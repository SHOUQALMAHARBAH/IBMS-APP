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
  receipt: null,
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
        receipt: {
          amount: { toString: () => '115350' },
          method: 'bank_transfer',
          receivedAt: new Date('2026-09-15T00:00:00Z'),
        },
      },
      'EN',
    );
    expect(html).toContain('Payment Received');
    expect(html).toContain('JOD 115,350.000');
    expect(html).toContain('bank_transfer');
    expect(html).toContain('Paid');
    expect(html).not.toContain('Outstanding');
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
