import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney } from './format';

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
