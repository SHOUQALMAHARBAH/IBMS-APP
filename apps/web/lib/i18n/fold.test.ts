import { describe, expect, it } from 'vitest';
import { foldForSearch, foldedIncludes } from './fold';
import { NAV } from './translations/nav';

// The point of these is the Arabic cases: an EN-only assertion would pass on a
// function that did nothing but lowercase.

describe('foldForSearch', () => {
  it('folds Latin case', () => {
    expect(foldForSearch('Claims Analytics')).toBe('claims analytics');
  });

  it('is idempotent, so a label and a query can be folded separately', () => {
    const once = foldForSearch('الاحتفاظ بالعُملاء');
    expect(foldForSearch(once)).toBe(once);
  });

  it('collapses whitespace and trims', () => {
    expect(foldForSearch('  Sales   performance ')).toBe('sales performance');
  });

  it('strips Arabic diacritics', () => {
    // Same word, once vocalised and once bare.
    expect(foldForSearch('العُمَلاء')).toBe(foldForSearch('العملاء'));
  });

  it('strips tatweel', () => {
    expect(foldForSearch('المطالـــبات')).toBe(foldForSearch('المطالبات'));
  });

  it('unifies every alef variant', () => {
    for (const variant of ['آ', 'أ', 'إ', 'ٱ']) {
      expect(foldForSearch(variant)).toBe('ا');
    }
  });

  it('folds alef maqsura to ya and teh marbuta to heh', () => {
    expect(foldForSearch('ى')).toBe('ي');
    expect(foldForSearch('ة')).toBe('ه');
  });

  it('leaves a folded Arabic string non-empty — it strips marks, not letters', () => {
    expect(foldForSearch('المبيعات')).toBe('المبيعات');
  });
});

describe('foldedIncludes', () => {
  it('matches regardless of case', () => {
    expect(foldedIncludes('Insurance programs', 'PROGRAM')).toBe(true);
  });

  it('treats an empty query as matching everything', () => {
    expect(foldedIncludes('anything', '')).toBe(true);
    expect(foldedIncludes('anything', '   ')).toBe(true);
  });

  it('still rejects a genuine non-match', () => {
    expect(foldedIncludes('Insurance programs', 'claims')).toBe(false);
  });

  it('matches an Arabic nav label typed with a plain alef', () => {
    // 'الاحتفاظ والإتلاف' carries إ; a user typing ا must still find it.
    expect(foldedIncludes(NAV.AR.navRetentionDisposal, 'والاتلاف')).toBe(true);
  });

  it('matches an Arabic nav label typed with diacritics the label omits', () => {
    expect(foldedIncludes(NAV.AR.navCustomers, 'العُملاء')).toBe(true);
  });
});

describe('the nav labels this actually filters', () => {
  it('folds every label in both languages to something non-empty', () => {
    for (const lang of ['AR', 'EN'] as const) {
      for (const [key, value] of Object.entries(NAV[lang])) {
        if (!key.startsWith('nav')) continue;
        expect(foldForSearch(value), `${lang}.${key}`).not.toBe('');
      }
    }
  });
});
