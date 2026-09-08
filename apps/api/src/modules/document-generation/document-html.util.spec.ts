import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatDocumentDate,
  formatDocumentMoney,
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
