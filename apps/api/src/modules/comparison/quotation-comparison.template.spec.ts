import { describe, expect, it } from 'vitest';
import {
  buildQuotationComparisonHtml,
  type QuotationComparisonData,
  type QuotationComparisonRow,
} from './quotation-comparison.template';

const ROW_A: QuotationComparisonRow = {
  insurerName: 'الاتحاد للتأمين',
  isCurrentVersion: true,
  premium: { toString: () => '1250.5' },
  currency: 'JOD',
  deductible: { toString: () => '100' },
  liabilityLimit: { toString: () => '500000' },
  biPeriodMonths: 12,
  commissionRatePercent: { toString: () => '15' },
  insurerQualityScore: { toString: () => '80' },
  serviceScore: { toString: () => '75' },
  exclusions: 'War risks',
  conditions: 'Annual inspection required',
};

const ROW_B: QuotationComparisonRow = {
  insurerName: 'Al-Ufuq Insurance',
  isCurrentVersion: false,
  premium: { toString: () => '1400' },
  currency: 'JOD',
  deductible: null,
  liabilityLimit: null,
  biPeriodMonths: null,
  commissionRatePercent: null,
  insurerQualityScore: null,
  serviceScore: null,
  exclusions: null,
  conditions: null,
};

const BASE_DATA: QuotationComparisonData = {
  comparisonId: 'cmp-123',
  insuranceLine: 'Property All Risks',
  customerLegalName: 'شركة الأفق للتأمين',
  builtAt: new Date('2026-03-05T00:00:00Z'),
  rows: [ROW_A, ROW_B],
  missingInsurers: [{ name: 'Jordan Insurance Co.', status: 'PENDING' }],
  declinedInsurers: [{ name: 'Middle East Insurance', status: 'DECLINED' }],
  bodyEn: 'Never price alone.',
  bodyAr: 'لا تعتمد على السعر وحده.',
};

describe('buildQuotationComparisonHtml', () => {
  it('renders an AR-only document with dir="rtl" and both insurers', () => {
    const html = buildQuotationComparisonHtml(BASE_DATA, 'AR');
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('dir="ltr"');
    expect(html).toContain('الاتحاد للتأمين');
    expect(html).toContain('Al-Ufuq Insurance');
    expect(html).toContain('لا تعتمد على السعر وحده.');
    expect(html).not.toContain('Never price alone.');
  });

  it('renders an EN-only document with dir="ltr"', () => {
    const html = buildQuotationComparisonHtml(BASE_DATA, 'EN');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain('dir="rtl"');
    expect(html).toContain('Never price alone.');
    expect(html).not.toContain('لا تعتمد على السعر وحده.');
  });

  it("DUAL renders both sections, Arabic first (this system's primary language)", () => {
    const html = buildQuotationComparisonHtml(BASE_DATA, 'DUAL');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('dir="ltr"');
    expect(html.indexOf('dir="rtl"')).toBeLessThan(html.indexOf('dir="ltr"'));
  });

  it('formats money with the JOD currency prefix and 3dp', () => {
    const html = buildQuotationComparisonHtml(BASE_DATA, 'EN');
    expect(html).toContain('JOD 1,250.500');
  });

  it('includes the comparison reference number so a client can cite it back', () => {
    const html = buildQuotationComparisonHtml(BASE_DATA, 'EN');
    expect(html).toContain('cmp-123');
  });

  it('marks a non-current-version quotation as superseded', () => {
    const html = buildQuotationComparisonHtml(BASE_DATA, 'EN');
    expect(html).toContain('superseded');
  });

  it('renders an em dash for every null field on a row, never "null" or "undefined"', () => {
    const html = buildQuotationComparisonHtml(BASE_DATA, 'EN');
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
    expect(html).toContain('—');
  });

  it('lists missing insurers with their status, and declined insurers separately', () => {
    const html = buildQuotationComparisonHtml(BASE_DATA, 'EN');
    expect(html).toContain('No quote to compare:');
    expect(html).toContain('Jordan Insurance Co. (PENDING)');
    expect(html).toContain('Declined:');
    expect(html).toContain('Middle East Insurance');
  });

  it('omits the missing/declined callouts entirely when both lists are empty', () => {
    const html = buildQuotationComparisonHtml(
      { ...BASE_DATA, missingInsurers: [], declinedInsurers: [] },
      'EN',
    );
    expect(html).not.toContain('No quote to compare:');
    expect(html).not.toContain('Declined:');
  });

  it('escapes HTML-shaped content in exclusions/conditions instead of injecting it raw', () => {
    const html = buildQuotationComparisonHtml(
      {
        ...BASE_DATA,
        rows: [{ ...ROW_A, exclusions: '<script>alert(1)</script>' }],
      },
      'EN',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes an insurer name too, not just exclusions/conditions', () => {
    const html = buildQuotationComparisonHtml(
      {
        ...BASE_DATA,
        rows: [{ ...ROW_A, insurerName: '<b>Evil</b> Insurance' }],
      },
      'EN',
    );
    expect(html).not.toContain('<b>Evil</b> Insurance');
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt; Insurance');
  });
});
