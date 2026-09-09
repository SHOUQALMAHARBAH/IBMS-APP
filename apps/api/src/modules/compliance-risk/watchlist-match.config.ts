import { NAME_TRANSLITERATION_GROUPS } from '../../common/name-transliteration.config';

/**
 * Process 49 — FUZZY name matching for sanctions screening.
 *
 * Why the exact match this replaces was not good enough. `normalizeWatchlistName`
 * upper-cases, strips punctuation and sorts tokens, so a hit required the
 * subject's name to be TOKEN-IDENTICAL to a list entry. For a Jordan-based
 * broker that misses the two commonest real shapes:
 *
 *   1. **Transliteration variants.** "MUHAMMAD AL HASHIMI" never matched a list
 *      entry spelled "MOHAMMED AL HASHIMI" — the same person, a different
 *      romanisation of the same Arabic name.
 *   2. **Name-length mismatch.** Jordanian national-ID convention is a four-part
 *      name (given/father/grandfather/family). OFAC and UN entries are usually
 *      two or three parts. "AHMAD KHALID YOUSEF AL HASHIMI" therefore never
 *      matched an entry for "AHMAD AL HASHIMI", even though every token of the
 *      entry is present in the subject's name.
 *
 * Both failures are SILENT: they produce a CLEAR result, which is the worst
 * possible failure mode for a sanctions control.
 *
 * The approach here is deliberately conservative and deterministic — no edit
 * distance, no phonetic algorithm, no scoring threshold to tune:
 *
 *   * Each token is canonicalised through the SAME curated transliteration
 *     table Part F item #6 already uses (`NAME_TRANSLITERATION_GROUPS`), which
 *     is a table of KNOWN variants, never a guess. A token with no known group
 *     is left as itself, so an unknown name can never be widened.
 *   * A candidate matches when EVERY canonical token of the watchlist entry is
 *     present in the subject's canonical tokens (entry ⊆ subject). This catches
 *     the extra-middle-names case without letting a short subject name match a
 *     long entry.
 *   * An entry must carry at least {@link MIN_ENTRY_TOKENS_FOR_FUZZY} tokens to
 *     be fuzzy-matchable at all. A single-token entry ("HEZBOLLAH") matching by
 *     subset would fire on any subject who happens to have that one token
 *     anywhere in a four-part name.
 *
 * Everything a fuzzy rule catches is a CANDIDATE for a human to review, never
 * an automatic block — see `ScreeningMatch` and its review queue.
 */

/** An entry shorter than this is exact-match-only. Subset matching on a
 * one-token entry is not screening, it is a substring search over a
 * 19,000-row list, and it would bury the review queue in noise. */
export const MIN_ENTRY_TOKENS_FOR_FUZZY = 2;

/** How a candidate was found. Surfaced to the reviewer, because an exact hit
 * and a subset hit deserve different scrutiny. */
export type WatchlistMatchType = 'exact' | 'fuzzy';

/**
 * token -> canonical representative, built once from the curated groups. The
 * representative is the group's FIRST entry, so the mapping is stable and
 * order-independent: every spelling of a name, in either script, collapses to
 * the same key.
 */
const CANONICAL_BY_TOKEN: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const group of NAME_TRANSLITERATION_GROUPS) {
    const representative = normalizeSingleToken(group[0]);
    for (const variant of group) {
      // A multi-word variant ("abdul rahman") canonicalises each of its own
      // words to the group, so it still collapses when the subject spells it
      // as two tokens.
      for (const word of normalizeSingleToken(variant).split(' ')) {
        if (word) map.set(word, representative);
      }
    }
  }
  return map;
})();

/** Lower-case, strip anything that is not a letter/number/space. Mirrors
 * `normalizeWatchlistName`'s character class so the two agree on what a token
 * even is; the case difference is irrelevant because both sides use this. */
function normalizeSingleToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/**
 * A name's canonical token set: normalised, transliteration-collapsed,
 * de-duplicated and sorted. Sorted and de-duplicated so the result is a stable
 * set — "AHMAD ALI" and "ALI AHMAD" produce the same tokens, which is correct
 * for name matching, and a repeated token cannot inflate a subset test.
 *
 * Returns `[]` for a name with no usable characters; callers must treat that
 * as "not screenable", never as "matches everything".
 */
export function canonicalNameTokens(name: string): string[] {
  const tokens = normalizeSingleToken(name).split(' ').filter(Boolean);
  const canonical = new Set<string>();
  for (const token of tokens) {
    canonical.add(CANONICAL_BY_TOKEN.get(token) ?? token);
  }
  return [...canonical].sort();
}

/**
 * True when every token of `entryTokens` appears in `subjectTokens` — i.e. the
 * watchlist entry's name is contained in the subject's name.
 *
 * Direction matters and is not symmetric: a subject with MORE names than the
 * entry is a candidate (the extra-middle-name case), a subject with FEWER is
 * not (an entry for "AHMAD KHALID AL HASHIMI" must not fire on a customer
 * merely called "AHMAD").
 */
export function entryTokensContainedInSubject(
  entryTokens: readonly string[],
  subjectTokens: readonly string[],
): boolean {
  if (entryTokens.length < MIN_ENTRY_TOKENS_FOR_FUZZY) return false;
  if (subjectTokens.length === 0) return false;
  const subject = new Set(subjectTokens);
  return entryTokens.every((token) => subject.has(token));
}

/** Whether two names are the same after canonicalisation — the exact case,
 * expressed in the same vocabulary as the fuzzy one so both can be reported
 * consistently. Two names that differ only by romanisation count as exact. */
export function canonicalNamesEqual(a: string, b: string): boolean {
  const left = canonicalNameTokens(a);
  const right = canonicalNameTokens(b);
  if (left.length === 0 || left.length !== right.length) return false;
  return left.every((token, i) => token === right[i]);
}

/**
 * Classify a confirmed candidate. Called only for entries the database has
 * already returned as containment matches, so the question is just whether it
 * is also an exact one.
 */
export function classifyMatch(
  subjectName: string,
  entryName: string,
): WatchlistMatchType {
  return canonicalNamesEqual(subjectName, entryName) ? 'exact' : 'fuzzy';
}
