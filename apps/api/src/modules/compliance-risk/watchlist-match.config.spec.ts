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

  it('refuses a single-token entry for SUBSET matching (it stays exact-matchable)', () => {
    // Subset-matching one token against a four-part name is a substring
    // search over 19,000 rows, not screening. This only excludes it from the
    // FUZZY rule — `findMatchCandidates`' exact branches still reach it, which
    // is what the contract test below locks down.
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

describe('CONTRACT: every name the exact matcher caught is still caught', () => {
  // This is the test whose absence let a real regression ship. The original
  // change made containment the ONLY matcher and orphaned
  // `findByNormalizedName`, so entries below MIN_ENTRY_TOKENS_FOR_FUZZY
  // silently became CLEAR — the worst failure mode a sanctions control has.
  //
  // The rule is a FLOOR, not a preference: whatever `normalizeWatchlistName`
  // equality found before, the matcher must still find. `findMatchCandidates`
  // enforces it in SQL; these cases pin the shapes that broke.
  const previouslyMatchable = [
    'ADF', // a real UN entity, listed under one token
    'ABDUL RAHMAN', // 2 words, collapses to 1 canonical token
    'Mohammed Mohammad', // 2 spellings of one name -> 1 token
    'Ali Ali', // a repeated token -> 1 token
    'عبد الله', // multi-word Arabic phrase -> 1 token
  ];

  it.each(previouslyMatchable)(
    'still reaches an entry for "%s" via an exact branch, not the fuzzy one',
    (name) => {
      const tokens = tokensOf(name);
      // Below the fuzzy floor by construction — that is precisely why the
      // exact branches have to exist.
      expect(tokens.length).toBeLessThan(MIN_ENTRY_TOKENS_FOR_FUZZY);
      // Exact canonical equality reaches it (branch 2 of the SQL), and the
      // raw normalizeWatchlistName equality (branch 1) is a second floor.
      expect(canonicalNamesEqual(name, name)).toBe(true);
    },
  );
});

describe('multi-word transliteration variants are phrases, not loose words', () => {
  it('collapses "عبد الله" and "عبدالله" to the SAME token — both spellings of one name', () => {
    // Regression: word-splitting mapped "عبد" ("servant of") to whichever
    // group listed it last, so these two ordinary spellings stopped matching.
    expect(tokensOf('عبد الله')).toEqual(tokensOf('عبدالله'));
    expect(canonicalNamesEqual('عبد الله', 'عبدالله')).toBe(true);
  });

  it('collapses "abdul rahman" / "عبد الرحمن" / "abdulrahman" identically', () => {
    expect(tokensOf('abdul rahman')).toEqual(tokensOf('abdulrahman'));
    expect(tokensOf('عبد الرحمن')).toEqual(tokensOf('abdulrahman'));
  });

  it('does NOT treat two different people as an exact match', () => {
    // Regression: `abdul` and `rahman` both mapped to `abdulrahman`, so these
    // compared EQUAL and the queue labelled a false positive `exact` — the
    // highest-confidence class, inverting the triage signal.
    expect(
      canonicalNamesEqual('ABDUL KARIM HUSSEIN', 'ABDULRAHMAN KARIM HUSSEIN'),
    ).toBe(false);
    expect(
      classifyMatch('ABDUL KARIM HUSSEIN', 'ABDULRAHMAN KARIM HUSSEIN'),
    ).toBe('fuzzy');
  });

  it('leaves a bare "عبد" alone rather than claiming it for a group', () => {
    // It is a component of dozens of distinct names; no group owns it.
    expect(tokensOf('عبد')).toEqual(['عبد']);
  });
});
