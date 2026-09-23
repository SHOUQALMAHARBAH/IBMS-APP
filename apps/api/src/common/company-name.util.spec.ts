import { describe, expect, it } from 'vitest';
import { canonicalNameKey, isSameName } from './company-name.util';

/**
 * The canonical name key — the exact-duplicate guarantee behind both insurance-line
 * additions and (later) the insurer directory's matching.
 *
 * Every rule below is one way the same name gets typed differently. The test that
 * matters most is the LAST one: it pins what this function cannot do, so nobody
 * later mistakes it for a similarity matcher and removes the layer that is.
 */

describe('canonicalNameKey — Arabic orthography', () => {
  it('folds every alef variant to ا', () => {
    // A user typing أ, إ, آ or ٱ has typed the same letter. The forms are a
    // keyboard and diacritics matter, not a different word.
    const forms = ['أمان', 'إمان', 'آمان', 'ٱمان', 'امان'];
    const keys = new Set(forms.map(canonicalNameKey));
    expect(keys.size).toBe(1);
  });

  it('strips diacritics and tatweel', () => {
    expect(isSameName('تَأْمِين', 'تامين')).toBe(true);
    // Tatweel stretches a word for justification and is never part of it.
    expect(isSameName('تـــأمين', 'تأمين')).toBe(true);
  });

  it('folds ة to ه and ى to ي', () => {
    expect(isSameName('التعاونية', 'التعاونيه')).toBe(true);
    expect(isSameName('الكبرى', 'الكبري')).toBe(true);
  });

  it('ignores the definite article, which is added and dropped freely', () => {
    // The case this exists for: a list entry typed with and without ال is one
    // line of business, not two.
    expect(isSameName('تأمين المركبات الشامل', 'تأمين مركبات شامل')).toBe(true);
  });

  it('leaves a short word that merely begins with ال alone', () => {
    // The article rule requires three more letters after it, so it cannot eat the
    // head of a genuinely short word and collapse two different names.
    expect(canonicalNameKey('الف')).toBe('الف');
  });
});

describe('canonicalNameKey — word order and punctuation', () => {
  it('sorts tokens, so word order does not create a second entry', () => {
    expect(isSameName('Motor Comprehensive', 'comprehensive motor')).toBe(true);
    expect(isSameName('شامل مركبات', 'مركبات شامل')).toBe(true);
  });

  it('treats punctuation as a separator', () => {
    expect(isSameName('Motor (Comprehensive)', 'Motor — Comprehensive')).toBe(
      true,
    );
    expect(isSameName('Marine/Cargo', 'marine cargo')).toBe(true);
  });

  it('collapses whitespace and trims', () => {
    expect(canonicalNameKey('  Motor   Comprehensive  ')).toBe(
      'comprehensive motor',
    );
  });

  it('is case-insensitive without being locale-sensitive', () => {
    // `toLocaleLowerCase` would fold a dotted I differently under a Turkish
    // locale, so the same name would key differently on two machines — and this key
    // carries a unique index.
    expect(isSameName('INDIVIDUAL LIFE', 'individual life')).toBe(true);
  });
});

describe('canonicalNameKey — properties a stored key needs', () => {
  it('is idempotent, so a stored key compares against a fresh one', () => {
    const once = canonicalNameKey('تأمين المركبات الشامل');
    expect(canonicalNameKey(once)).toBe(once);
  });

  it('returns an empty key for a value with no letters or digits', () => {
    // Not a crash and not a space — an empty key, which the caller refuses. A DTO
    // length check means this is unreachable through the API, and it is asserted
    // here so the function is safe for any other caller.
    expect(canonicalNameKey('--- ()')).toBe('');
  });

  it('keeps genuinely different names different', () => {
    expect(isSameName('Marine Cargo', 'Marine Hull')).toBe(false);
    expect(isSameName('تأمين السفر', 'تأمين الحياة')).toBe(false);
    // The four engineering lines are four entries and must stay four: an insurer
    // may write one and not another, so folding them together would make a
    // directory search answer a question it was not asked.
    expect(isSameName("Contractors' All Risks", 'Erection All Risks')).toBe(
      false,
    );
  });

  it('does NOT recognise synonyms, which is why a similarity layer is still needed', () => {
    // The limit, pinned deliberately. These mean the same thing to a broker and
    // share no words, so no normalisation can equate them. This key is the exact
    // guarantee that can be a database constraint; the "did you mean" suggestion is
    // a separate layer on top of it, never a replacement for it.
    expect(isSameName('سيارات شامل', 'تأمين المركبات الشامل')).toBe(false);
  });
});
