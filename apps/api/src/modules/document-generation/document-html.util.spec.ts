import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatDocumentBiPeriod,
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
} from './document-html.util';

describe('escapeHtml', () => {
  it('escapes all 5 HTML-special characters', () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Al-Ufuq Trading Co.')).toBe('Al-Ufuq Trading Co.');
  });
});

describe('formatDocumentDate', () => {
  it('produces genuinely different output for ar vs. en-GB', () => {
    const d = new Date('2026-03-05T00:00:00Z');
    expect(formatDocumentDate(d, 'en')).not.toBe(formatDocumentDate(d, 'ar'));
  });

  /*
   * 🔴 OWNER DECISION 153 §U2 + DECISION 146 RULING 1 — PINNED HERE, not only on the one
   * template that found it.
   *
   * The certificate's own spec asserts «تشرين الثاني» on the rendered page, and that is where
   * the defect was read. But this function is shared by SIX document types, and the test above
   * — AR differs from EN — passes under every Arabic locale tag there is, including the two
   * that are wrong. So the ruling belongs to the formatter: a later edit to `AR_MONTH_LOCALE`
   * would otherwise be caught only by a template that happens to assert a month.
   *
   * Both directions, because the two wrong answers fail differently:
   *   `ar`      -> «نوفمبر»            the wrong dialect, in the right digits
   *   `ar-JO`   -> «١٨ تشرين الثاني»   the right word, in digits decision 146 ruling 1 forbids
   */
  it('🔴 spells the month the Levantine way AND keeps the digits Western', () => {
    const november = formatDocumentDate(new Date('2026-11-18T00:00:00Z'), 'ar');
    expect(november).toContain('تشرين الثاني');
    expect(november).not.toContain('نوفمبر');

    const october = formatDocumentDate(new Date('2026-10-05T00:00:00Z'), 'ar');
    expect(october).toContain('تشرين الأول');
    expect(october).not.toContain('أكتوبر');

    // «كل رقم مكتوب في نصوص النظام غربي» — no Eastern Arabic-Indic numeral may appear, which
    // is what rules out the bare region tag that spells the month correctly.
    for (const formatted of [november, october]) {
      expect(formatted).not.toMatch(/[٠-٩]/);
      expect(formatted).toMatch(/[0-9]/);
    }
  });
});

describe('formatDocumentMoney', () => {
  it('returns an em dash for null', () => {
    expect(formatDocumentMoney(null, 'en')).toBe('—');
  });

  it('formats a Decimal-shaped value to 3dp with the currency prefix, defaulting to JOD', () => {
    expect(formatDocumentMoney({ toString: () => '1250.5' }, 'en')).toBe(
      'JOD 1,250.500',
    );
  });

  it('uses the given currency instead of the JOD default', () => {
    expect(formatDocumentMoney({ toString: () => '500' }, 'en', 'USD')).toBe(
      'USD 500.000',
    );
  });

  it('passes a non-finite value through raw with the currency prefix', () => {
    expect(formatDocumentMoney({ toString: () => 'n/a' }, 'en')).toBe(
      'JOD n/a',
    );
  });

  it('escapes an HTML-shaped non-finite value instead of injecting it raw', () => {
    expect(formatDocumentMoney({ toString: () => '<b>x</b>' }, 'en')).toBe(
      'JOD &lt;b&gt;x&lt;/b&gt;',
    );
  });
});

describe('formatDocumentBiPeriod', () => {
  it('returns an em dash for null', () => {
    expect(formatDocumentBiPeriod(null, 'en')).toBe('—');
  });

  it('renders bilingual "N months" labels', () => {
    expect(formatDocumentBiPeriod(12, 'en')).toBe('12 mo');
    expect(formatDocumentBiPeriod(12, 'ar')).toBe('12 شهر');
  });
});

describe('formatDocumentPercent', () => {
  it('returns an em dash for null', () => {
    expect(formatDocumentPercent(null, 'en')).toBe('—');
  });

  it('renders a bilingual percent sign on the correct side', () => {
    expect(formatDocumentPercent({ toString: () => '15' }, 'en')).toBe('15%');
    expect(formatDocumentPercent({ toString: () => '15' }, 'ar')).toBe('%15');
  });

  it('escapes HTML-shaped content exactly once, not zero or twice', () => {
    expect(formatDocumentPercent({ toString: () => '<b>1</b>' }, 'en')).toBe(
      '&lt;b&gt;1&lt;/b&gt;%',
    );
  });
});
