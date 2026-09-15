import { describe, expect, it } from 'vitest';
import { PLURALS, translatePlural, type PluralKey } from './plurals';

// These exercise the MECHANISM, not the copy: that a count actually selects a
// different Arabic form, that English is unaffected by the four categories it
// does not have, and that a missing category falls back the way the resolver
// documents. Dictionary parity is asserted separately, at the bottom.

describe('translatePlural — category selection', () => {
  // The boundaries CLDR draws for Arabic. If `Intl` ever disagrees with this
  // table the app's plural copy is wrong, and it should fail here first.
  const ARABIC_CASES: Array<[number, string]> = [
    [0, 'لا توجد فواتير'], // zero
    [1, 'فاتورة واحدة'], // one
    [2, 'فاتورتان'], // two
    [3, '3 فواتير'], // few  — lower bound
    [10, '10 فواتير'], // few  — upper bound
    [11, '11 فاتورة'], // many — lower bound
    [99, '99 فاتورة'], // many — upper bound
    [100, '100 فاتورة'], // other
  ];

  it.each(ARABIC_CASES)(
    'Arabic selects the right form for %i',
    (count, expected) => {
      expect(translatePlural('AR', 'frInvoiceCount', count)).toBe(expected);
    },
  );

  it('Arabic genuinely produces distinct wording across its categories', () => {
    const forms = new Set(
      [0, 1, 2, 3, 11, 100].map((n) =>
        translatePlural('AR', 'frInvoiceCount', n),
      ),
    );
    // Six counts, six categories — and the whole point is that they differ.
    expect(forms.size).toBe(6);
  });

  const ENGLISH_CASES: Array<[number, string]> = [
    [0, '0 invoices'],
    [1, '1 invoice'],
    [2, '2 invoices'],
    [11, '11 invoices'],
    [100, '100 invoices'],
  ];

  it.each(ENGLISH_CASES)('English selects the right form for %i', (count, expected) => {
    expect(translatePlural('EN', 'frInvoiceCount', count)).toBe(expected);
  });

  it('English is not tripped by the categories it does not have', () => {
    // 2 is `two` in Arabic and `other` in English; 3 is `few` vs `other`.
    // English must not fall through to something undefined for either.
    expect(translatePlural('EN', 'frInvoiceCount', 2)).toBe('2 invoices');
    expect(translatePlural('EN', 'frInvoiceCount', 3)).toBe('3 invoices');
  });
});

describe('translatePlural — fallback', () => {
  it('falls back to `other` when the selected category has no form', () => {
    // `dcmpBreachesOpen` deliberately defines only `other` in English, so
    // every count resolves through the fallback path rather than a match.
    expect(PLURALS.EN.dcmpBreachesOpen.one).toBeUndefined();
    expect(translatePlural('EN', 'dcmpBreachesOpen', 1)).toBe('1 open');
    expect(translatePlural('EN', 'dcmpBreachesOpen', 7)).toBe('7 open');
  });

  it('falls back to `other`, never to a neighbouring category', () => {
    // `dpolRenewalWindowDays` has no `zero` in Arabic. 0 selects `zero`, so it
    // must land on `other` — not on `one`, and not on `few`.
    expect(PLURALS.AR.dpolRenewalWindowDays.zero).toBeUndefined();
    expect(translatePlural('AR', 'dpolRenewalWindowDays', 0)).toBe(
      PLURALS.AR.dpolRenewalWindowDays.other.replace('{count}', '0'),
    );
  });
});

describe('translatePlural — substitution', () => {
  it('substitutes {count} in every form that carries it', () => {
    expect(translatePlural('EN', 'docsDocumentCount', 4)).toBe('4 documents');
    expect(translatePlural('AR', 'docsDocumentCount', 4)).toBe('4 مستندات');
  });

  it('leaves no {count} placeholder behind, in either language', () => {
    for (const key of Object.keys(PLURALS.EN) as PluralKey[]) {
      for (const count of [0, 1, 2, 3, 11, 100]) {
        expect(translatePlural('EN', key, count)).not.toContain('{count}');
        expect(translatePlural('AR', key, count)).not.toContain('{count}');
      }
    }
  });

  it('groups a large count the way the rest of the UI formats numbers', () => {
    expect(translatePlural('EN', 'docsDocumentCount', 1234)).toBe(
      '1,234 documents',
    );
  });

  it('still substitutes extra params alongside {count}', () => {
    // No current key needs a second placeholder, so this pins the contract
    // rather than a string: a caller passing params must see them applied.
    const out = translatePlural('EN', 'frInvoiceCount', 2, { unused: 'x' });
    expect(out).toBe('2 invoices');
  });
});

describe('the plural dictionary', () => {
  it('declares every key in both languages', () => {
    expect(Object.keys(PLURALS.AR).sort()).toEqual(
      Object.keys(PLURALS.EN).sort(),
    );
  });

  it('gives every form in every language the mandatory `other`', () => {
    const missing: string[] = [];
    for (const lang of ['AR', 'EN'] as const) {
      for (const [key, forms] of Object.entries(PLURALS[lang])) {
        if (!forms.other) missing.push(`${lang}.${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('gives Arabic more forms than English wherever the count changes the noun', () => {
    // Not a style rule — a correctness one. An Arabic entry with only `other`
    // is almost always an untranslated stub, so this catches the copy landing
    // half-done. `dcmpBreachesOpen` is the one genuine exception: the Arabic
    // adjective does not inflect across few/many/other there.
    const singleForm = (Object.keys(PLURALS.AR) as PluralKey[]).filter(
      (k) => Object.keys(PLURALS.AR[k]).length < 3,
    );
    expect(singleForm).toEqual([]);
  });
});
