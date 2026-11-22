import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  buildQuotationComparisonHtml,
  type QuotationComparisonData,
  type QuotationComparisonRow,
} from './quotation-comparison.template';

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
const ROW_A: QuotationComparisonRow = {
  insurerName: 'الاتحاد للتأمين',
  insurerNameAr: null,
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
  insurerNameAr: null,
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

  /*
   * 🔴 REVERSED BY OWNER DECISION 155 RULING 3, and kept rather than deleted.
   *
   * This asserted the opposite: that the comparison’s internal id is printed «so a client
   * can cite it back». Measured for her: no model behind this document carries a
   * customer-facing number at all — not the comparison, not the RFQ, not the opportunity —
   * so what a client could cite back was a 36-character uuid nobody had ever shown them. Her
   * ruling removes the row; the paper is identified by the customer, the line and the date.
   *
   * ⛔ And the id left `QuotationComparisonData` entirely, so this is structural rather than
   * disciplinary: the renderer does not HAVE an internal id and cannot print one.
   */
  it('⛔ prints NO internal reference, in either language (decision 155 ruling 3)', () => {
    for (const lang of ['EN', 'AR'] as const) {
      const html = buildQuotationComparisonHtml(BASE_DATA, lang);
      expect(html).not.toContain('cmp-123');
      expect(html).not.toContain('Reference');
      expect(html).not.toContain('رقم المرجع');
    }
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

  /*
   * 🔴 DECISION 153 §U2, APPLIED TO THE FOUR DOCUMENTS THE CERTIFICATE'S FIX REPORTED.
   *
   * «أسماء شركات التأمين وفروع التأمين تُطبَع بالعربية حيث هي موجودة». The fixture below is
   * NON-VACUOUS BY CONSTRUCTION: the Latin name is genuinely Latin and the Arabic one is a
   * different string, so a template that ignored `insurerNameAr` would fail the first
   * assertion, and one that printed Arabic into the English render would fail the last.
   */
  it('🔴 decision 153 §U2 — the Arabic comparison says «فرع التأمين» and names the insurer in Arabic', () => {
    const bilingualRow: QuotationComparisonRow = {
      ...ROW_A,
      insurerName: 'Al-Ittihad Insurance',
      insurerNameAr: 'الاتحاد للتأمين',
    };
    const data: QuotationComparisonData = {
      ...BASE_DATA,
      rows: [bilingualRow],
      missingInsurers: [],
      declinedInsurers: [],
    };

    const ar = buildQuotationComparisonHtml(data, 'AR');
    // Decision 150 ruling 5 — the label the certificate already carries.
    expect(ar).toContain('فرع التأمين');
    expect(ar).not.toContain('خط التأمين');
    // The insurer in the reader's language, and NOT the Latin name beside it.
    expect(ar).toContain('الاتحاد للتأمين');
    expect(ar).not.toContain('Al-Ittihad Insurance');

    /*
     * ⚠️ THE LINE IS STILL THE STORED ENGLISH STRING, AND THAT IS ASSERTED RATHER THAN
     * LEFT UNSAID. `COMPARISON_INCLUDE` selects the RFQ's `insuranceLine` string only, so
     * there is no Arabic line name to read here; §1 of message 49 rules out the query
     * change that would give it one. If this ever stops being true, this line fails and
     * whoever changed the query is told to finish the job.
     */
    expect(ar).toContain('Property All Risks');

    const en = buildQuotationComparisonHtml(data, 'EN');
    expect(en).toContain('Al-Ittihad Insurance');
    expect(en).not.toContain('الاتحاد للتأمين');
  });
});

/**
 * 🔴 OWNER DECISION 155 RULING 3 — THE STATUS WORDS, AND THE TWO HOMES PINNED TOGETHER.
 *
 * This template renders a flagged insurer's response state in words rather than as the stored
 * token. It CANNOT import the screens' dictionary — `apps/web` and `apps/api` are separate
 * builds — so the five words are copied in, the way every other label in this file's template
 * is copied in.
 *
 * ⚠️ A COPIED STRING IS A SECOND HOME, so it is pinned: this reads the dictionary at test time
 * and compares byte for byte. Without it, a reword on the screen would leave the customer's
 * paper saying the old word, and nothing anywhere would notice.
 */
describe('decision 155 ruling 3 — the insurer response state in words', () => {
  const WEB_RFQ = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'web',
    'lib',
    'i18n',
    'translations',
    'rfq.ts',
  );

  /** `key -> value`, for one half of the dictionary file. */
  function dictionary(half: 'AR' | 'EN'): Map<string, string> {
    const src = readFileSync(WEB_RFQ, 'utf8');
    const at = src.indexOf(`  ${half}: {`);
    expect(at, `the ${half} half is not in rfq.ts`).toBeGreaterThan(-1);
    const out = new Map<string, string>();
    for (const line of src.slice(at).split('\n')) {
      const m = /^\s*(rfqInsurerStatus[A-Za-z]+):\s*'([^']*)',/.exec(line);
      if (m && !out.has(m[1])) out.set(m[1], m[2]);
    }
    return out;
  }

  it.each([
    ['SENT', 'rfqInsurerStatusSent'],
    ['VIEWED', 'rfqInsurerStatusViewed'],
    ['QUOTED', 'rfqInsurerStatusQuoted'],
    ['DECLINED', 'rfqInsurerStatusDeclined'],
    ['NO_RESPONSE', 'rfqInsurerStatusNoResponse'],
  ])('%s renders the same Arabic word the screens use', (status, key) => {
    const want = dictionary('AR').get(key);
    expect(want, `${key} is not in rfq.ts's AR half`).toBeTruthy();
    const html = buildQuotationComparisonHtml(
      {
        ...BASE_DATA,
        missingInsurers: [{ name: 'Middle East Assurance', status }],
      },
      'AR',
    );
    expect(html).toContain(`Middle East Assurance (${want})`);
  });

  it('⛔ and the stored token never reaches the Arabic paper', () => {
    const html = buildQuotationComparisonHtml(
      {
        ...BASE_DATA,
        missingInsurers: [
          { name: 'Middle East Assurance', status: 'NO_RESPONSE' },
        ],
      },
      'AR',
    );
    // The whole finding: «شركة الشرق الأوسط (NO_RESPONSE)» on a customer's document.
    expect(html).not.toContain('(NO_RESPONSE)');
  });

  it('⚠️ an unknown value renders AS STORED rather than blank (decision 49)', () => {
    // Unreachable today — the column is a Prisma enum — but an unreachable fallback that prints
    // the token beats a reachable one that prints nothing.
    const html = buildQuotationComparisonHtml(
      {
        ...BASE_DATA,
        missingInsurers: [
          { name: 'Middle East Assurance', status: 'WITHDRAWN' },
        ],
      },
      'AR',
    );
    expect(html).toContain('Middle East Assurance (WITHDRAWN)');
  });

  it('⛔ AND THE REFERENCE ROW IS GONE FROM BOTH HALVES (ruling 3)', () => {
    const html = [
      buildQuotationComparisonHtml(BASE_DATA, 'AR'),
      buildQuotationComparisonHtml(BASE_DATA, 'EN'),
    ].join('');
    expect(html).not.toContain('رقم المرجع');
    expect(html).not.toContain('>Reference<');
    // Structural, not disciplinary: the renderer does not HAVE the id, so it cannot print one.
    expect(html).not.toContain('cmp-');
  });
});
