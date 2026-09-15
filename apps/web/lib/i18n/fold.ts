// Folding for in-page filtering — today, the sidebar's module search.
//
// A substring match on the raw label is wrong for Arabic. The same word is
// routinely typed with a different alef (أ إ آ ٱ vs ا), with or without
// diacritics, with ة where the reader expects ه, and with tatweel (ـ) used to
// stretch a word for justification. None of those change the word; all of them
// break `includes()`. A user who types a module's name correctly would be told
// it does not exist.
//
// Deliberately NOT a general-purpose search normaliser, and deliberately not
// the API's `name-transliteration.config.ts` — that one exists for
// cross-script sanctions screening, where the rules (and the cost of a false
// negative) are entirely different. This folds ONE string against ONE typed
// query, for navigation. Part F item #6's fuzzier same-script typo tolerance
// is still open, separate work.
//
// Latin is folded by case only. `toLocaleLowerCase()` is avoided on purpose:
// it is locale-sensitive, and the Turkish dotless-i rule would make an EN
// label fold differently depending on the user's locale, which is exactly the
// kind of silent inconsistency this function exists to remove.

/** Arabic combining marks (fathatan..sukun) plus the superscript alef. */
const DIACRITICS = /[ً-ْٰ]/g;
/** Tatweel — a justification glyph, never part of a word. */
const TATWEEL = /ـ/g;
const ALEF_VARIANTS = /[آأإٱ]/g; // آ أ إ ٱ
const ALEF_MAQSURA = /ى/g; // ى
const TEH_MARBUTA = /ة/g; // ة

/**
 * Case- and orthography-insensitive form of `value`, for substring matching.
 *
 * Idempotent: folding an already-folded string returns it unchanged, so a
 * label and a query can be folded independently and still compare.
 */
export function foldForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(ALEF_VARIANTS, 'ا') // -> ا
    .replace(ALEF_MAQSURA, 'ي') // -> ي
    .replace(TEH_MARBUTA, 'ه') // -> ه
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `haystack` contains `needle`, both folded. An empty needle
 *  matches everything, so a caller can skip the emptiness check. */
export function foldedIncludes(haystack: string, needle: string): boolean {
  const q = foldForSearch(needle);
  if (!q) return true;
  return foldForSearch(haystack).includes(q);
}
