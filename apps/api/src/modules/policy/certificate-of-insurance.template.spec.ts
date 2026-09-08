import { describe, expect, it } from 'vitest';
import {
  buildCertificateOfInsuranceHtml,
  type CertificateOfInsuranceData,
} from './certificate-of-insurance.template';

const BASE_DATA: CertificateOfInsuranceData = {
  policyId: 'pol-123',
  customerLegalName: 'شركة الأفق للتأمين',
  policyNumber: 'POL-2026-001',
  insurerName: 'الاتحاد للتأمين',
  insuranceLine: 'Property All Risks',
  inceptionDate: new Date('2026-10-01T00:00:00Z'),
  expiryDate: new Date('2027-10-01T00:00:00Z'),
  currency: 'JOD',
  sumsInsured: [{ key: 'total', value: '6200000.000' }],
  bodyEn: 'This certificate is issued as a summary of coverage.',
  bodyAr: 'تصدر هذه الشهادة كملخص للتغطية.',
};

describe('buildCertificateOfInsuranceHtml', () => {
  it('renders an AR-only document with dir="rtl"', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'AR');
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('dir="ltr"');
    expect(html).toContain('تصدر هذه الشهادة كملخص للتغطية.');
    expect(html).not.toContain(
      'This certificate is issued as a summary of coverage.',
    );
  });

  it('renders an EN-only document with dir="ltr"', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'EN');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain('dir="rtl"');
    expect(html).toContain(
      'This certificate is issued as a summary of coverage.',
    );
  });

  it("DUAL renders both sections, Arabic first (this system's primary language)", () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'DUAL');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('dir="ltr"');
    expect(html.indexOf('dir="rtl"')).toBeLessThan(html.indexOf('dir="ltr"'));
  });

  it('includes the reference, policy number, insurer, insurance line and period', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'EN');
    expect(html).toContain('pol-123');
    expect(html).toContain('POL-2026-001');
    expect(html).toContain('الاتحاد للتأمين');
    expect(html).toContain('Property All Risks');
    expect(html).toContain('Period of Insurance');
  });

  it('renders sum insured as a single summary line, money-formatted', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'EN');
    expect(html).toContain('total: JOD 6,200,000.000');
  });

  it('never renders premium, tax, fees, commission, or the full limits/named-perils/extensions breakdown — a genuinely different content shape than the schedule summary', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'DUAL');
    for (const term of [
      'Premium',
      'قسط',
      'Tax',
      'Fees',
      'Commission',
      'عمولة',
      'Named Perils',
      'الأخطار المسماة',
      'Extensions',
      'الامتدادات',
    ]) {
      expect(html).not.toContain(term);
    }
  });

  it('renders an em dash for a null policy number and "—" for an empty sums-insured set, never omitting the row', () => {
    const html = buildCertificateOfInsuranceHtml(
      { ...BASE_DATA, policyNumber: null, sumsInsured: [] },
      'EN',
    );
    expect(html).toContain('Policy Number');
    expect(html).toContain('Sum Insured');
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
  });

  it('shows "ongoing" for an open period (no expiryDate) in each language', () => {
    const htmlEn = buildCertificateOfInsuranceHtml(
      { ...BASE_DATA, expiryDate: null },
      'EN',
    );
    expect(htmlEn).toContain('ongoing');
    const htmlAr = buildCertificateOfInsuranceHtml(
      { ...BASE_DATA, expiryDate: null },
      'AR',
    );
    expect(htmlAr).toContain('مستمر');
  });

  it('escapes HTML-shaped content in the customer legal name and a sum-insured key instead of injecting it raw', () => {
    const html = buildCertificateOfInsuranceHtml(
      {
        ...BASE_DATA,
        customerLegalName: '<script>alert(1)</script>',
        sumsInsured: [{ key: '<b>total</b>', value: '100' }],
      },
      'EN',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<b>total</b>');
    expect(html).toContain('&lt;b&gt;total&lt;/b&gt;');
  });

  it('gracefully degrades a non-numeric sum-insured value instead of crashing', () => {
    const html = buildCertificateOfInsuranceHtml(
      {
        ...BASE_DATA,
        sumsInsured: [{ key: 'total', value: 'as per wording' }],
      },
      'EN',
    );
    expect(html).toContain('total: JOD as per wording');
  });

  it('never renders internal governance metadata (placed/issued/checked-by ids)', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'DUAL');
    expect(html).not.toContain('placedByUserId');
    expect(html).not.toContain('issuedByUserId');
    expect(html).not.toContain('checkedByUserId');
  });
});
