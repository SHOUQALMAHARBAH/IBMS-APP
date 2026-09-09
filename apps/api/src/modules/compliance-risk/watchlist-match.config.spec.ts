import { describe, expect, it } from 'vitest';
import {
  MIN_ENTRY_TOKENS_FOR_FUZZY,
  canonicalNameTokens,
  canonicalNamesEqual,
  classifyMatch,
  entryTokensContainedInSubject,
} from './watchlist-match.config';

const tokensOf = canonicalNameTokens;

describe('canonicalNameTokens', () => {
  it('collapses every known romanisation of a name to one key', () => {
    const spellings = [
      'Mohammed',
      'Muhammad',
      'Mohamed',
      'Mohammad',
      'Muhammed',
    ];
    const keys = spellings.map((s) => tokensOf(s).join('|'));
    expect(new Set(keys).size).toBe(1);
  });

  it('collapses the ARABIC-SCRIPT spelling to the same key as the Latin one', () => {
    // This is the case the exact matcher could never hit: a customer recorded
    // in Arabic can now match a Latin-script sanctions entry on the given name.
    expect(tokensOf('محمد')).toEqual(tokensOf('Mohammed'));
    expect(tokensOf('أحمد')).toEqual(tokensOf('Ahmad'));
  });

  it('leaves a name with no known variant completely alone', () => {
    // An unknown name must never be widened — that is how false positives get
    // manufactured out of nothing.
    expect(tokensOf('Zzyzx')).toEqual(['zzyzx']);
  });

  it('is order-independent and de-duplicated', () => {
    expect(tokensOf('Ahmad Ali')).toEqual(tokensOf('Ali Ahmad'));
    expect(tokensOf('Ahmad Ahmad')).toEqual(['ahmad']);
  });

  it('strips punctuation so hyphenation cannot hide a match', () => {
    expect(tokensOf('AL-HASHIMI')).toEqual(tokensOf('Al Hashimi'));
  });

  it('returns [] for a name with no usable characters', () => {
    expect(tokensOf('   ')).toEqual([]);
    expect(tokensOf('!!! ---')).toEqual([]);
  });

  it('canonicalises a multi-word variant word-by-word', () => {
    // "abdul rahman" is one group entry but two tokens in a real name.
    expect(tokensOf('Abdul Rahman')).toEqual(tokensOf('Abdulrahman'));
  });
});

describe('entryTokensContainedInSubject', () => {
  it('matches a 4-part Jordanian name against a shorter list entry', () => {
    // The second silent-miss case: the entry is fully contained in the subject.
    const subject = tokensOf('Ahmad Khalid Yousef Al Hashimi');
    const entry = tokensOf('Ahmad Al Hashimi');
    expect(entryTokensContainedInSubject(entry, subject)).toBe(true);
  });

  it('matches across romanisation AND extra names at once', () => {
    const subject = tokensOf('Muhammad Khalid Al Hashimi');
    const entry = tokensOf('Mohammed Al Hashimi');
    expect(entryTokensContainedInSubject(entry, subject)).toBe(true);
  });

  it('is NOT symmetric: a short subject does not match a longer entry', () => {
    const subject = tokensOf('Ahmad');
    const entry = tokensOf('Ahmad Khalid Al Hashimi');
    expect(entryTokensContainedInSubject(entry, subject)).toBe(false);
  });

  it('refuses a single-token entry — subset matching there is a substring search', () => {
    const subject = tokensOf('Ahmad Khalid Hezbollah Street');
    expect(entryTokensContainedInSubject(tokensOf('Hezbollah'), subject)).toBe(
      false,
    );
    expect(MIN_ENTRY_TOKENS_FOR_FUZZY).toBe(2);
  });

  it('does not match on a partial overlap', () => {
    const subject = tokensOf('Ahmad Khalid Al Rifai');
    const entry = tokensOf('Ahmad Al Hashimi');
    expect(entryTokensContainedInSubject(entry, subject)).toBe(false);
  });

  it('never matches an empty subject', () => {
    expect(entryTokensContainedInSubject(tokensOf('Ahmad Ali'), [])).toBe(
      false,
    );
  });
});

describe('canonicalNamesEqual / classifyMatch', () => {
  it('treats a pure romanisation difference as EXACT, not fuzzy', () => {
    expect(canonicalNamesEqual('Muhammad Ali', 'Mohammed Ali')).toBe(true);
    expect(classifyMatch('Muhammad Ali', 'Mohammed Ali')).toBe('exact');
  });

  it('treats an extra middle name as FUZZY', () => {
    expect(classifyMatch('Ahmad Khalid Al Hashimi', 'Ahmad Al Hashimi')).toBe(
      'fuzzy',
    );
  });

  it('an empty name is never equal to anything', () => {
    expect(canonicalNamesEqual('', '')).toBe(false);
    expect(canonicalNamesEqual('   ', 'Ahmad')).toBe(false);
  });
});
