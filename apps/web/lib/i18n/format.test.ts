import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPeriodLabel,
} from './format';

describe('formatMoney', () => {
  it('formats a JOD amount to 3dp', () => {
    expect(formatMoney('1234.5', 'EN')).toBe('JOD 1,234.500');
    expect(formatMoney('1234.5', 'AR')).toBe('JOD 1,234.500');
  });

  it('returns an em dash for null (unchanged from every prior duplicated money())', () => {
    expect(formatMoney(null, 'EN')).toBe('—');
  });

  it('passes a non-numeric value through raw with the currency prefix', () => {
    expect(formatMoney('n/a', 'EN')).toBe('JOD n/a');
  });

  it('honors a custom currency code', () => {
    expect(formatMoney('500.000', 'EN', 'USD')).toBe('USD 500.000');
  });
});

describe('formatDate', () => {
  const iso = '2026-09-07T00:00:00.000Z';
  // ICU inserts invisible Unicode direction-control marks (LRM U+200E /
  // RLM U+200F) between an Arabic-locale date's components — stripped by
  // codepoint before asserting the visible digits, since asserting the
  // exact byte sequence (including control characters typed inline in this
  // source file) would be fragile and unreadable.
  const stripDirectionMarks = (s: string) => s.replace(/[‎‏]/g, '');

  it("formats DD/MM/YYYY for EN ('en-GB'), not US-style MM/DD/YYYY", () => {
    expect(formatDate(iso, 'EN')).toBe('07/09/2026');
  });

  it('genuinely uses Arabic-locale formatting for AR, not just the EN string again', () => {
    const ar = formatDate(iso, 'AR');
    const en = formatDate(iso, 'EN');
    expect(ar).not.toBe(en);
    expect(stripDirectionMarks(ar)).toBe('7/9/2026');
  });
});

describe('formatDateTime', () => {
  it('includes both a date and a time component', () => {
    const out = formatDateTime('2026-09-07T14:30:00.000Z', 'EN');
    expect(out).toContain('07/09/2026');
    expect(out).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

/*
 * OWNER DECISION 58 — THE MONTH NAME, AND WHY A PLAYWRIGHT RUN CANNOT SEE IT.
 *
 * Her example is «١٢٠ خلال تشرين الأول», and only THREE of the twelve Levantine month
 * names exist anywhere in this product's source, so writing «تشرين الأول» would be
 * typing Arabic — which decision 94 reserves to her. `formatPeriodLabel` gets it from
 * ICU instead, under `ar-JO-u-nu-latn`.
 *
 * THIS TEST EXISTS BECAUSE NOTHING ELSE OBSERVES THAT CHOICE. Every Playwright mock in
 * this suite reports `languagePreference: "EN"`, so the Arabic branch is never rendered
 * in a browser test: a plant swapping the locale back to `'ar'` would leave both
 * dashboard specs green while an Arabic reader saw «أغسطس» instead of «آب». A pure
 * function belongs in a unit test, which is also the only layer that can assert the
 * DIGITS — the part the region tag would otherwise have changed.
 */
describe('formatPeriodLabel (owner decision 58)', () => {
  it('gives the Levantine month name in Arabic, which is her own vocabulary', () => {
    // «تشرين الأول» is October. `'ar'` alone would give «أكتوبر», which is a different
    // dialect and not the word she used.
    expect(formatPeriodLabel('2026-10', 'AR')).toContain('تشرين الأول');
    expect(formatPeriodLabel('2026-09', 'AR')).toContain('أيلول');
    expect(formatPeriodLabel('2026-01', 'AR')).toContain('كانون الثاني');
  });

  it('keeps the YEAR in Western digits, which is what the `-u-nu-latn` extension is for', () => {
    // `'ar-JO'` WITHOUT the extension renders «٢٠٢٦», and `format.ts`'s own note on
    // `AR_LOCALE` records that Eastern Arabic-Indic numerals would be a real visual
    // change from every reference and policy number in this app. This is the assertion
    // that would fail if somebody "simplified" the tag.
    const out = formatPeriodLabel('2026-10', 'AR');
    expect(out).toContain('2026');
    expect(out).not.toContain('٢٠٢٦');
  });

  it('gives the English month name in English', () => {
    expect(formatPeriodLabel('2026-10', 'EN')).toBe('October 2026');
    expect(formatPeriodLabel('2026-01', 'EN')).toBe('January 2026');
  });

  it('returns a malformed label UNCHANGED rather than guessing at it', () => {
    // Read straight off the wire. A label that is not `YYYY-MM` should be visible as
    // itself — silently becoming January would hide a real api change behind a
    // plausible-looking month.
    for (const bad of ['', '2026', '2026-13', '2026-00', 'last-month', '2026-1']) {
      expect(formatPeriodLabel(bad, 'AR')).toBe(bad);
      expect(formatPeriodLabel(bad, 'EN')).toBe(bad);
    }
  });

  it('does not shift the month across a timezone boundary', () => {
    // Built with `Date.UTC` and formatted with `timeZone: 'UTC'`. Without the second
    // half, a machine west of Greenwich would render the PREVIOUS month for every
    // label — a whole-month error that only appears on some developers' machines.
    expect(formatPeriodLabel('2026-01', 'EN')).toBe('January 2026');
    expect(formatPeriodLabel('2026-12', 'EN')).toBe('December 2026');
  });
});
