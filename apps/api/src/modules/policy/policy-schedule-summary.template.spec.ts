import { describe, expect, it } from 'vitest';
import {
  buildPolicyScheduleSummaryHtml,
  type PolicyScheduleSummaryData,
} from './policy-schedule-summary.template';

const BASE_DATA: PolicyScheduleSummaryData = {
  policyId: 'pol-123',
  customerLegalName: 'شركة الأفق للتأمين',
  insurerName: 'الاتحاد للتأمين',
  policyNumber: 'POL-2026-001',
  insuranceLine: 'Property All Risks',
  inceptionDate: new Date('2026-10-01T00:00:00Z'),
  expiryDate: new Date('2027-10-01T00:00:00Z'),
  requestedPremium: { toString: () => '120000' },
  issuedPremium: { toString: () => '118500' },
  premiumVariance: '-1500.000',
  currency: 'JOD',
  scheduleEffectiveFrom: new Date('2026-10-01T00:00:00Z'),
  scheduleEffectiveTo: null,
  limits: [
    { key: 'buildings', value: '5000000.000' },
    { key: 'contents', value: '1200000.000' },
  ],
  sumsInsured: [{ key: 'total', value: '6200000.000' }],
  namedPerils: ['fire', 'flood', 'theft'],
  extensions: ['debris removal'],
  bodyEn: 'This document summarizes the coverage currently in force.',
  bodyAr: 'يلخّص هذا المستند التغطية السارية حالياً.',
};

describe('buildPolicyScheduleSummaryHtml', () => {
  it('renders an AR-only document with dir="rtl"', () => {
    const html = buildPolicyScheduleSummaryHtml(BASE_DATA, 'AR');
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('dir="ltr"');
    expect(html).toContain('يلخّص هذا المستند التغطية السارية حالياً.');
    expect(html).not.toContain(
      'This document summarizes the coverage currently in force.',
    );
  });

  it('renders an EN-only document with dir="ltr"', () => {
    const html = buildPolicyScheduleSummaryHtml(BASE_DATA, 'EN');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain('dir="rtl"');
    expect(html).toContain(
      'This document summarizes the coverage currently in force.',
    );
  });

  it("DUAL renders both sections, Arabic first (this system's primary language)", () => {
    const html = buildPolicyScheduleSummaryHtml(BASE_DATA, 'DUAL');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('dir="ltr"');
    expect(html.indexOf('dir="rtl"')).toBeLessThan(html.indexOf('dir="ltr"'));
  });

  it('includes the policy reference number and policy number so a client can cite them back', () => {
    const html = buildPolicyScheduleSummaryHtml(BASE_DATA, 'EN');
    expect(html).toContain('pol-123');
    expect(html).toContain('POL-2026-001');
  });

  it('includes the insurer, insurance line, dates and both premiums with the variance', () => {
    const html = buildPolicyScheduleSummaryHtml(BASE_DATA, 'EN');
    expect(html).toContain('الاتحاد للتأمين');
    expect(html).toContain('Property All Risks');
    expect(html).toContain('JOD 120,000.000'); // requested premium
    expect(html).toContain('JOD 118,500.000'); // issued premium
    expect(html).toContain('JOD -1,500.000'); // variance
  });

  it('renders every limits and sums-insured entry as a money-formatted row, using the raw key as the label', () => {
    const html = buildPolicyScheduleSummaryHtml(BASE_DATA, 'EN');
    expect(html).toContain('buildings');
    expect(html).toContain('JOD 5,000,000.000');
    expect(html).toContain('contents');
    expect(html).toContain('JOD 1,200,000.000');
    expect(html).toContain('total');
    expect(html).toContain('JOD 6,200,000.000');
  });

  it('renders named perils and extensions as comma-separated lists', () => {
    const html = buildPolicyScheduleSummaryHtml(BASE_DATA, 'EN');
    expect(html).toContain('fire, flood, theft');
    expect(html).toContain('debris removal');
  });

  it('renders an em dash for a null policy number, expiry date and empty perils/extensions, never omitting the row', () => {
    const html = buildPolicyScheduleSummaryHtml(
      {
        ...BASE_DATA,
        policyNumber: null,
        expiryDate: null,
        namedPerils: [],
        extensions: [],
      },
      'EN',
    );
    expect(html).toContain('Policy Number');
    expect(html).toContain('Expiry');
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
  });

  it('shows "ongoing" for an open schedule (no effectiveTo) in each language', () => {
    const htmlEn = buildPolicyScheduleSummaryHtml(BASE_DATA, 'EN');
    expect(htmlEn).toContain('ongoing');
    const htmlAr = buildPolicyScheduleSummaryHtml(BASE_DATA, 'AR');
    expect(htmlAr).toContain('مستمر');
  });

  it('renders no coverage-figure table when limits/sumsInsured are both empty, without crashing', () => {
    const html = buildPolicyScheduleSummaryHtml(
      { ...BASE_DATA, limits: [], sumsInsured: [] },
      'EN',
    );
    expect(html).not.toContain('<h2>Limits</h2>');
    expect(html).not.toContain('<h2>Sums Insured</h2>');
  });

  it('never renders internal governance metadata (placed/issued/checked-by ids)', () => {
    const html = buildPolicyScheduleSummaryHtml(BASE_DATA, 'DUAL');
    expect(html).not.toContain('placedByUserId');
    expect(html).not.toContain('issuedByUserId');
    expect(html).not.toContain('checkedByUserId');
  });

  it('escapes HTML-shaped content in a coverage-figure key instead of injecting it raw', () => {
    const html = buildPolicyScheduleSummaryHtml(
      {
        ...BASE_DATA,
        limits: [{ key: '<script>alert(1)</script>', value: '100' }],
      },
      'EN',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes HTML-shaped content in named perils / extensions instead of injecting it raw', () => {
    const html = buildPolicyScheduleSummaryHtml(
      {
        ...BASE_DATA,
        namedPerils: ['<img src=x onerror=alert(1)>'],
        extensions: ['<b>debris</b>'],
      },
      'EN',
    );
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<b>debris</b>');
    expect(html).toContain('&lt;b&gt;debris&lt;/b&gt;');
  });

  it('gracefully degrades a non-numeric coverage-figure value instead of crashing', () => {
    const html = buildPolicyScheduleSummaryHtml(
      {
        ...BASE_DATA,
        limits: [{ key: 'combined single limit', value: 'as per wording' }],
      },
      'EN',
    );
    expect(html).toContain('combined single limit');
    expect(html).toContain('JOD as per wording');
  });

  it('renders an em dash for a null issued premium (no variance) instead of omitting the row', () => {
    const html = buildPolicyScheduleSummaryHtml(
      { ...BASE_DATA, issuedPremium: null, premiumVariance: null },
      'EN',
    );
    expect(html).toContain('Issued Premium');
  });
});
