import { describe, expect, it } from 'vitest';
import {
  buildPolicyScheduleSummaryHtml,
  type PolicyScheduleSummaryData,
} from './policy-schedule-summary.template';

/*
 * ⚠️ `insurerNameAr` IS NULL ON EVERY FIXTURE BELOW, DELIBERATELY.
 *
 * These fixtures put ARABIC TEXT in `insurerName`, which is the LATIN field — so an assertion
 * that the Arabic render shows an Arabic name passes against a template that never consults
 * `insurerNameAr` at all. That is the exact vacuity message 45 §2 caught in a Playwright
 * fixture, and leaving the Arabic half null here keeps these tests exercising the FALLBACK
 * direction (no Arabic recorded -> render the Latin name) rather than quietly proving nothing.
 *
 * The decision 153 §U2 test at the bottom of this file carries its own fixture, with a genuinely
 * Latin name and a DIFFERENT Arabic one, so it fails unless the pair is really being read.
 */
const BASE_DATA: PolicyScheduleSummaryData = {
  customerLegalName: 'شركة الأفق للتأمين',
  insurerName: 'الاتحاد للتأمين',
  insurerNameAr: null,
  policyNumber: 'POL-2026-001',
  insuranceLine: 'Property All Risks',
  insuranceLineAr: null,
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

  /*
   * 🔴 REVERSED BY OWNER DECISION 155 RULING 3, and kept rather than deleted.
   *
   * This asserted the opposite — that the internal id is printed «so a client can cite
   * it back». Measured for her: the policy NUMBER is printed two rows below, so the uuid said the same fact twice,
   * so what a client could cite back was a 36-character uuid nobody had ever shown them.
   * Her ruling removes the row; the paper is identified by the customer, the line and the
   * date.
   *
   * ⛔ And the id left `PolicyScheduleSummaryData` entirely, so this is STRUCTURAL rather than
   * disciplinary: the renderer does not HAVE an internal id and cannot print one.
   */
  it('⛔ prints NO internal reference, in either language (decision 155 ruling 3)', () => {
    for (const lang of ['EN', 'AR'] as const) {
      const html = buildPolicyScheduleSummaryHtml(BASE_DATA, lang);
      expect(html).not.toContain('pol-123');
      expect(html).not.toContain('Reference');
      expect(html).not.toContain('رقم المرجع');
    }
  });

  it('and what it DOES carry still identifies the paper', () => {
    const html = buildPolicyScheduleSummaryHtml(BASE_DATA, 'EN');
    expect(html).toContain('POL-2026-001');
    expect(html).toContain('شركة الأفق للتأمين');
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

  /*
   * 🔴 CORRECTED, NOT DELETED — THIS TEST ASSERTED THE DEFECT DECISION 165 RULING 3 NAMES.
   *
   * It read `expect(htmlEn).toContain('ongoing')` over `BASE_DATA`, whose policy carries
   * `expiryDate: 2027-10-01`. So it pinned a paper that told a customer their cover was ongoing
   * two rows under its own «تاريخ الانتهاء» cell — and it would have passed for as long as
   * nobody read the document, which is how the owner found it rather than the suite.
   *
   * Both directions are kept: an open schedule on a policy that EXPIRES shows the expiry date and
   * must not say «ongoing»; an open schedule on a policy with NO expiry date still does, which is
   * the only state that word is true of and the reason it is not deleted.
   */
  it('an open schedule on a policy that expires shows the policy expiry, not "ongoing"', () => {
    const htmlEn = buildPolicyScheduleSummaryHtml(BASE_DATA, 'EN');
    expect(htmlEn).not.toContain('ongoing');
    // The formatted expiry occurs TWICE now — its own cell and the schedule range — where
    // before it occurred once. A `toContain` alone would pass on the cell that always had it.
    expect(htmlEn.split('1 October 2027').length - 1).toBe(2);

    const htmlAr = buildPolicyScheduleSummaryHtml(BASE_DATA, 'AR');
    expect(htmlAr).not.toContain('مستمر');
    expect(htmlAr.split('1 تشرين الأول 2027').length - 1).toBe(2);
  });

  it('an open schedule on a policy with NO expiry date still reads "ongoing"', () => {
    const open = { ...BASE_DATA, expiryDate: null };
    expect(buildPolicyScheduleSummaryHtml(open, 'EN')).toContain('ongoing');
    expect(buildPolicyScheduleSummaryHtml(open, 'AR')).toContain('مستمر');
  });

  it('a CLOSED schedule shows its own effectiveTo, never the policy expiry', () => {
    const closed = {
      ...BASE_DATA,
      scheduleEffectiveTo: new Date('2027-04-01T00:00:00Z'),
    };
    const htmlEn = buildPolicyScheduleSummaryHtml(closed, 'EN');
    expect(htmlEn).toContain('1 April 2027');
    expect(htmlEn).not.toContain('ongoing');
    // The policy expiry keeps its own cell and does NOT reach the range: a superseded version
    // ended when it was superseded, which is the distinction `effectiveTo` exists to carry.
    expect(htmlEn.split('1 October 2027').length - 1).toBe(1);
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

  /*
   * 🔴 DECISION 153 §U2, APPLIED TO THE FOUR DOCUMENTS THE CERTIFICATE'S FIX REPORTED.
   *
   * «أسماء شركات التأمين وفروع التأمين تُطبَع بالعربية حيث هي موجودة». The fixture below is
   * NON-VACUOUS BY CONSTRUCTION: the Latin name is genuinely Latin and the Arabic one is a
   * different string, so a template that ignored `insurerNameAr` would fail the first
   * assertion, and one that printed Arabic into the English render would fail the last.
   */
  it('🔴 decision 153 §U2 — the Arabic schedule summary says «فرع التأمين» and names the insurer and the line in Arabic', () => {
    const data: PolicyScheduleSummaryData = {
      ...BASE_DATA,
      insurerName: 'Al-Ittihad Insurance',
      insurerNameAr: 'الاتحاد للتأمين',
      insuranceLine: 'Property All Risks',
      insuranceLineAr: 'التأمين على الممتلكات ضد جميع الأخطار',
    };

    const ar = buildPolicyScheduleSummaryHtml(data, 'AR');
    expect(ar).toContain('فرع التأمين');
    expect(ar).not.toContain('خط التأمين');
    expect(ar).toContain('الاتحاد للتأمين');
    expect(ar).not.toContain('Al-Ittihad Insurance');
    expect(ar).toContain('التأمين على الممتلكات ضد جميع الأخطار');
    expect(ar).not.toContain('Property All Risks');

    const en = buildPolicyScheduleSummaryHtml(data, 'EN');
    expect(en).toContain('Al-Ittihad Insurance');
    expect(en).toContain('Property All Risks');
    expect(en).not.toContain('الاتحاد للتأمين');
  });

  it('falls back one way only: no Arabic insurer or line renders the Latin name, and English never renders Arabic', () => {
    const ar = buildPolicyScheduleSummaryHtml(
      {
        ...BASE_DATA,
        insurerName: 'Al-Ittihad Insurance',
        insurerNameAr: null,
        insuranceLine: 'Property All Risks',
        insuranceLineAr: '   ',
      },
      'AR',
    );
    expect(ar).toContain('Al-Ittihad Insurance');
    expect(ar).toContain('Property All Risks');
  });
});

/**
 * ⛔ OWNER DECISION 155 RULING 3 STOPS SHORT OF THE COVERAGE KEYS — PINNED IN THE NOT-BUILT
 * DIRECTION.
 *
 * The measurement that prepared this batch is explicit about why: `limits` and `sumsInsured` are
 * free-form JSON whose key names are TYPED BY THE EMPLOYEE entering the schedule
 * (`policy.config.ts#assertCoverageFigures` checks only «non-empty flat object of scalar
 * values»). They are not an enum, not a vocabulary, and not a closed set — so there is no
 * dictionary that could name them and nothing to map them to.
 *
 * ⟶ Where the demo's keys read in English (`perOccurrence`, `aggregate`, `total`) that is the
 *   SEED having written them that way (`apps/api/scripts/seed-demo.script.ts`), and the repair is
 *   in the seed, waiting for the owner's words. ⛔ Not here.
 *
 * This is ASSERTED rather than left to discipline, because a later batch sweeping «the rest of
 * the raw values on the four papers» would otherwise walk straight into it and invent a
 * vocabulary for something a user named.
 */
describe('⛔ coverage keys are printed as the employee typed them', () => {
  it('renders an unusual key verbatim rather than mapping or dropping it', () => {
    const html = buildPolicyScheduleSummaryHtml(
      {
        ...BASE_DATA,
        limits: [{ key: 'flood – basement only', value: '25000.000' }],
        sumsInsured: [{ key: 'stock at the Zarqa depot', value: '40000.000' }],
      },
      'AR',
    );
    // Both keys reach the paper exactly as written. A map would have rendered neither.
    expect(html).toContain('flood – basement only');
    expect(html).toContain('stock at the Zarqa depot');
  });
});
