import { NAME_TRANSLITERATION_GROUPS } from '../../common/name-transliteration.config';

/**
 * Process 49 — FUZZY name matching for sanctions screening.
 *
 * Why the exact match this ADDS TO was not good enough. `normalizeWatchlistName`
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
 * ## Containment NEVER replaces exact matching — it is strictly additive
 *
 * The first version of this file made containment the ONLY matcher and
 * orphaned `WatchlistEntryRepository.findByNormalizedName`. A `@code-reviewer`
 * pass caught that this REGRESSED the control for two families of entry, both
 * of which the old exact matcher caught and both of which then returned CLEAR:
 *
 *   * **Natively single-token entries.** `watchlist-sync.config.ts` names a
 *     real one: a UN entity listed under the single token "ADF". Below the
 *     {@link MIN_ENTRY_TOKENS_FOR_FUZZY} floor, so containment skips it, and
 *     with no exact branch it became unmatchable at any input.
 *   * **Multi-token entries this table collapsed to one token** (see the
 *     phrase-matching note below) — "ABDUL RAHMAN" reduced to `[abdulrahman]`
 *     and fell through the same floor.
 *
 * `WatchlistEntryRepository.findMatchCandidates` therefore ORs three
 * branches, and the exact one is the floor that guarantees no regression:
 * whatever the pre-change matcher found, this still finds. See its query.
 */

/** An entry shorter than this is exact-match-only. Subset matching on a
 * one-token entry is not screening, it is a substring search over a
 * 19,000-row list, and it would bury the review queue in noise.
 *
 * NOTE: "exact-match-only" is load-bearing, not a consolation — a single-token
 * entry is still reachable through the exact branches of the candidate query.
 * It is only excluded from SUBSET matching. */
/**
 * Part B §13 — the version of the MATCHING RULES, stamped onto every attempt
 * and every match they raise.
 *
 * Bump this whenever a change could make the same subject and the same list
 * entry produce a different answer: the transliteration table, the
 * canonicalisation, the fuzzy floor, the containment rule. Do NOT bump it for
 * a comment, a refactor, or a test.
 *
 * It exists because a reviewer opening an old match needs to know what
 * produced it. "This scored 0.82" is not interpretable six months later if
 * nobody recorded which matcher, and against which threshold, that 0.82 was
 * judged. Without it, tuning the matcher silently rewrites the meaning of
 * every match already in the queue.
 *
 * History:
 *   1.0.0  exact token-set equality only (pre-Process 49)
 *   2.0.0  + transliteration-collapsed canonical tokens, + containment
 *          matching for entries of two or more tokens (Process 49)
 */
export const MATCHING_ALGORITHM_VERSION = '2.0.0';

export const MIN_ENTRY_TOKENS_FOR_FUZZY = 2;

/** How a candidate was found. Surfaced to the reviewer, because an exact hit
 * and a subset hit deserve different scrutiny. */
export type WatchlistMatchType = 'exact' | 'fuzzy';

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
 * The curated table, compiled into two lookups.
 *
 * ## Why a multi-word variant is a PHRASE, never its individual words
 *
 * The first version registered every WORD of every variant against the group's
 * representative. That is wrong, and a `@code-reviewer` pass proved it by
 * running the real table through the real canonicaliser:
 *
 *   * `abdul rahman` and `abdel rahman` contributed `abdul`, `abdel` and
 *     `rahman`, all mapped to `abdulrahman`. So `ABDUL RAHMAN` canonicalised to
 *     a SINGLE token and dropped below the fuzzy floor entirely, and unrelated
 *     names sharing the word `abdul` were pulled into the same group.
 *   * Worse, `عبد` — which is simply "servant of", the first word of dozens of
 *     distinct names — was contributed by BOTH the `abdullah` and the
 *     `abdulrahman` groups. Last writer won, so `عبد الله` canonicalised to
 *     `[abdullah, abdulrahman]` while `عبدالله` canonicalised to `[abdullah]`:
 *     the two ordinary spellings of the SAME name stopped matching each other,
 *     which is the exact cross-script capability this table exists to provide.
 *   * And `ABDUL KARIM HUSSEIN` compared EQUAL to `ABDULRAHMAN KARIM HUSSEIN` —
 *     two different people, classified `exact`, the highest-confidence label
 *     the review queue can show.
 *
 * So: a variant containing a space is registered whole, in `CANONICAL_BY_PHRASE`,
 * and matched by a greedy longest-phrase scan in {@link canonicalNameTokens}.
 * Only genuinely single-word variants enter `CANONICAL_BY_TOKEN`.
 *
 * First writer wins on a collision, so the mapping does not depend on the order
 * the table happens to list its groups.
 */
const { CANONICAL_BY_TOKEN, CANONICAL_BY_PHRASE, MAX_PHRASE_WORDS } = (() => {
  const byToken = new Map<string, string>();
  const byPhrase = new Map<string, string>();
  let maxPhraseWords = 1;

  for (const group of NAME_TRANSLITERATION_GROUPS) {
    const representative = normalizeSingleToken(group[0]);
    for (const variant of group) {
      const normalized = normalizeSingleToken(variant);
      if (!normalized) continue;
      const words = normalized.split(' ');
      if (words.length > 1) {
        if (!byPhrase.has(normalized)) byPhrase.set(normalized, representative);
        maxPhraseWords = Math.max(maxPhraseWords, words.length);
      } else if (!byToken.has(normalized)) {
        byToken.set(normalized, representative);
      }
    }
  }

  return {
    CANONICAL_BY_TOKEN: byToken as ReadonlyMap<string, string>,
    CANONICAL_BY_PHRASE: byPhrase as ReadonlyMap<string, string>,
    MAX_PHRASE_WORDS: maxPhraseWords,
  };
})();

/**
 * A name's canonical token set: normalised, transliteration-collapsed,
 * de-duplicated and sorted. Sorted and de-duplicated so the result is a stable
 * set — "AHMAD ALI" and "ALI AHMAD" produce the same tokens, which is correct
 * for name matching, and a repeated token cannot inflate a subset test.
 *
 * Multi-word variants are consumed greedily longest-first, so "عبد الله"
 * collapses to the same single `abdullah` token as "عبدالله" does, while the
 * bare word "عبد" on its own is left alone rather than being claimed by
 * whichever group happened to list it last.
 *
 * Returns `[]` for a name with no usable characters; callers must treat that
 * as "not screenable", never as "matches everything".
 */
export function canonicalNameTokens(name: string): string[] {
  const words = normalizeSingleToken(name).split(' ').filter(Boolean);
  const canonical = new Set<string>();

  for (let i = 0; i < words.length;) {
    // Longest phrase first, so "abdul rahman" wins over a bare "abdul".
    const maxLen = Math.min(MAX_PHRASE_WORDS, words.length - i);
    let matched = false;
    for (let len = maxLen; len >= 2; len--) {
      const phrase = words.slice(i, i + len).join(' ');
      const representative = CANONICAL_BY_PHRASE.get(phrase);
      if (representative !== undefined) {
        canonical.add(representative);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const word = words[i];
      canonical.add(CANONICAL_BY_TOKEN.get(word) ?? word);
      i += 1;
    }
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
 *
 * An entry below {@link MIN_ENTRY_TOKENS_FOR_FUZZY} is refused here and reached
 * through the exact branches instead — see this file's header.
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
 * already returned as a candidate, so the question is just whether it is also
 * an exact one.
 */
export function classifyMatch(
  subjectName: string,
  entryName: string,
): WatchlistMatchType {
  return canonicalNamesEqual(subjectName, entryName) ? 'exact' : 'fuzzy';
}
