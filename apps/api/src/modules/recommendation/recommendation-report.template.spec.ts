import { describe, expect, it } from 'vitest';
import {
  buildRecommendationReportHtml,
  type RecommendationReportData,
} from './recommendation-report.template';

const BASE_DATA: RecommendationReportData = {
  recommendationId: 'rec-123',
  customerLegalName: 'شركة الأفق للتأمين',
  insuranceLine: 'Property All Risks',
  createdAt: new Date('2026-03-05T00:00:00Z'),
  insurerName: 'الاتحاد للتأمين',
  premium: { toString: () => '1250.5' },
  currency: 'JOD',
  deductible: { toString: () => '100' },
  liabilityLimit: { toString: () => '500000' },
  biPeriodMonths: 12,
  commissionRatePercent: { toString: () => '15' },
  exclusions: 'War risks',
  conditions: 'Annual inspection required',
  rationale: 'Best overall balance of coverage and price.',
  rationaleFactors: {
    coverage: 'Matches every requested peril.',
    price: 'Second lowest premium.',
    financialStrength: 'A- rated carrier.',
    claimsService: 'Local adjuster panel.',
    deductible: 'In line with the market.',
    policyConditions: 'No unusual warranties.',
  },
  conflictOfInterestFlagged: false,
  conflictOfInterestDisclosureText: null,
  bodyEn: 'We recommend the following.',
  bodyAr: 'نوصي بما يلي.',
};

describe('buildRecommendationReportHtml', () => {
  it('renders an AR-only document with dir="rtl"', () => {
    const html = buildRecommendationReportHtml(BASE_DATA, 'AR');
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('dir="ltr"');
    expect(html).toContain('نوصي بما يلي.');
    expect(html).not.toContain('We recommend the following.');
  });

  it('renders an EN-only document with dir="ltr"', () => {
    const html = buildRecommendationReportHtml(BASE_DATA, 'EN');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain('dir="rtl"');
    expect(html).toContain('We recommend the following.');
  });

  it("DUAL renders both sections, Arabic first (this system's primary language)", () => {
    const html = buildRecommendationReportHtml(BASE_DATA, 'DUAL');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('dir="ltr"');
    expect(html.indexOf('dir="rtl"')).toBeLessThan(html.indexOf('dir="ltr"'));
  });

  it('includes the recommendation reference number so a client can cite it back', () => {
    const html = buildRecommendationReportHtml(BASE_DATA, 'EN');
    expect(html).toContain('rec-123');
  });

  it("includes the recommended insurer and the quote's full commercial terms", () => {
    const html = buildRecommendationReportHtml(BASE_DATA, 'EN');
    expect(html).toContain('الاتحاد للتأمين');
    expect(html).toContain('JOD 1,250.500'); // premium
    expect(html).toContain('JOD 100.000'); // deductible
    expect(html).toContain('JOD 500,000.000'); // liability limit
    expect(html).toContain('12 mo'); // BI period
    expect(html).toContain('15%'); // commission rate
    expect(html).toContain('War risks / Annual inspection required');
  });

  it('renders an em dash for every null commercial-term field, never omitting the row', () => {
    const html = buildRecommendationReportHtml(
      {
        ...BASE_DATA,
        deductible: null,
        liabilityLimit: null,
        biPeriodMonths: null,
        commissionRatePercent: null,
        exclusions: null,
        conditions: null,
      },
      'EN',
    );
    expect(html).toContain('Deductible');
    expect(html).toContain('Commission Rate');
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
  });

  it('includes all 6 rationale factors with their bilingual labels', () => {
    const htmlEn = buildRecommendationReportHtml(BASE_DATA, 'EN');
    for (const label of [
      'Coverage',
      'Price',
      'Insurer Financial Strength',
      'Claims Service',
      'Deductible',
      'Policy Conditions',
    ]) {
      expect(htmlEn).toContain(label);
    }
    const htmlAr = buildRecommendationReportHtml(BASE_DATA, 'AR');
    expect(htmlAr).toContain('التغطية');
    expect(htmlAr).toContain('القوة المالية لشركة التأمين');
  });

  it('includes the COI disclosure text when flagged, and omits the section entirely when not', () => {
    const flagged = buildRecommendationReportHtml(
      {
        ...BASE_DATA,
        conflictOfInterestFlagged: true,
        conflictOfInterestDisclosureText:
          'We disclosed that this insurer pays a higher commission than a comparable competing quote.',
      },
      'EN',
    );
    expect(flagged).toContain('Conflict-of-Interest Disclosure');
    expect(flagged).toContain('We disclosed that this insurer pays');

    const notFlagged = buildRecommendationReportHtml(BASE_DATA, 'EN');
    expect(notFlagged).not.toContain('Conflict-of-Interest Disclosure');
  });

  it('never renders internal governance metadata (drafter/approver/sender ids)', () => {
    const html = buildRecommendationReportHtml(BASE_DATA, 'DUAL');
    expect(html).not.toContain('draftedBy');
    expect(html).not.toContain('approvedBy');
    expect(html).not.toContain('sentBy');
  });

  it('escapes HTML-shaped content in the rationale and factor notes instead of injecting it raw', () => {
    const html = buildRecommendationReportHtml(
      {
        ...BASE_DATA,
        rationale: '<script>alert(1)</script>',
        rationaleFactors: {
          ...BASE_DATA.rationaleFactors,
          coverage: '<b>Full</b> cover',
        },
      },
      'EN',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<b>Full</b> cover');
    expect(html).toContain('&lt;b&gt;Full&lt;/b&gt; cover');
  });

  it('escapes HTML-shaped content in the COI disclosure text too', () => {
    const html = buildRecommendationReportHtml(
      {
        ...BASE_DATA,
        conflictOfInterestFlagged: true,
        conflictOfInterestDisclosureText: '<img src=x onerror=alert(1)>',
      },
      'EN',
    );
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes the commission rate exactly once, not zero or twice', () => {
    const html = buildRecommendationReportHtml(
      { ...BASE_DATA, commissionRatePercent: { toString: () => '<b>1</b>' } },
      'EN',
    );
    expect(html).toContain('&lt;b&gt;1&lt;/b&gt;%');
    // A double-escape would turn "&lt;" into "&amp;lt;" — assert that
    // never happens.
    expect(html).not.toContain('&amp;lt;');
  });
});
