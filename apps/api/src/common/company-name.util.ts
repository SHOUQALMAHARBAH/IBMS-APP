/**
 * A canonical KEY for a bilingual business name, for deciding whether two names
 * are the same name.
 *
 * Built for insurance-line additions and written here rather than inside that
 * module because the insurer directory's own name matching needs exactly this
 * function: "has some office already registered this company?" and "has some
 * office already added this line type?" are one question about two vocabularies.
 * Building it twice would give two answers.
 *
 * ## What it does, and what it deliberately does not
 *
 * It folds ORTHOGRAPHY and WORD ORDER, both of which vary without changing the
 * name:
 *
 *  - Arabic is routinely typed with a different alef (أ إ آ ٱ for ا), with or
 *    without diacritics, with ة where the reader expects ه, with ى for ي, and with
 *    tatweel (ـ) stretching a word for justification. None of that changes the
 *    word; all of it breaks an equality test.
 *  - The definite article ال is dropped and added freely in a list entry —
 *    "تأمين المركبات" and "تأمين مركبات" are one line of business.
 *  - Word order varies in both scripts. "Motor Comprehensive" and "comprehensive
 *    motor" are one entry, so the tokens are SORTED rather than compared in place.
 *
 * It does NOT attempt synonyms, and that limit matters: "سيارات شامل" and
 * "تأمين المركبات الشامل" mean the same thing and this function will never say so,
 * because they share no words. Catching THAT needs a similarity layer, which is its
 * own piece of work. So this key is the exact-duplicate guarantee — strong enough
 * to be a database constraint, which a fuzzy score can never be — and the
 * suggestion layer sits on top of it later, not instead of it.
 *
 * ## Why this is a second copy of the folding rules
 *
 * `apps/web/lib/i18n/fold.ts` folds Arabic the same way for the sidebar's
 * in-page filter. The duplication is real and is recorded rather than hidden:
 * there is no shared package between `apps/api` and `apps/web` (only
 * `packages/db`, which is Prisma), and inventing one for a string function is a
 * bigger decision than this change should make. The two also differ in purpose —
 * that one folds for SUBSTRING matching against a typed query, this one produces a
 * canonical key that gets STORED and carries a unique index — so they are allowed
 * to diverge, but the orthography rules must not. If one gains a rule, give the
 * other the same rule.
 */

/** Arabic combining marks (fathatan..sukun) plus the superscript alef. */
const DIACRITICS = /[ً-ْٰ]/g;
/** Tatweel — a justification glyph, never part of a word. */
const TATWEEL = /ـ/g;
/** آ أ إ ٱ -> ا */
const ALEF_VARIANTS = /[آأإٱ]/g;
/** ى -> ي */
const ALEF_MAQSURA = /ى/g;
/** ة -> ه */
const TEH_MARBUTA = /ة/g;

/**
 * The case fold, ENUMERATED rather than `toLowerCase()`.
 *
 * `toLowerCase()` folds every uppercase letter in Unicode; the SQL function cannot, because
 * doing so there means `lower()`, which is CTYPE-dependent — and under a `C` ctype it folds
 * ASCII only. Rather than leave the two implementations agreeing by luck on one image, BOTH
 * now fold the same enumerated set: ASCII plus the Latin-1 capitals.
 */
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ';
const LOWER = 'abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþ';
const FOLD = new Map(
  [...UPPER].map((char, index) => [char, LOWER[index]] as const),
);

/**
 * Anything outside the ENUMERATED sets becomes a separator, so "Motor (Comprehensive)" and
 * "Motor — Comprehensive" fold together.
 *
 * This was `[^\p{L}\p{N}\s]`, which has no equivalent in Postgres regex — the SQL side used
 * `[^[:alnum:][:space:]]`, a POSIX class whose meaning is the database's locale. Under a `C`
 * ctype it matches ASCII only, which would have turned every Arabic letter into punctuation
 * and keyed every Arabic name to the empty string. Both sides now enumerate instead, so
 * neither consults a locale:
 *
 *  - Arabic, the whole U+0600..U+06FF block;
 *  - Latin: ASCII letters plus the Latin-1 letters (ß, à-ö, ø-þ) that a European reinsurer's
 *    name plausibly carries — Zürich, Münchener, Société;
 *  - digits.
 *
 * Every other script — Cyrillic, Greek, CJK — is a separator, exactly as punctuation is. A
 * deliberate limit for a system whose registration form demands a Latin AND an Arabic name,
 * and one that has to be widened on BOTH sides together if it is ever widened.
 *
 * Whitespace is deliberately NOT in the allowed set: a tab or a newline is outside it and
 * therefore already becomes a space, which is why the split below is on a literal space run
 * rather than `\s+` — `\s` is another CTYPE-dependent class in Postgres.
 */
const NON_WORD = /[^a-z0-9ß-öø-þ؀-ۿ]/g;
/** The Arabic definite article at the head of a token. Three letters minimum
 *  after it, so a short word that merely begins with those letters is left
 *  alone. */
const DEFINITE_ARTICLE = /^ال(?=[؀-ۿ]{3,})/;

/** The enumerated case fold, character by character — the mirror of the SQL `translate()`. */
function foldCase(value: string): string {
  let out = '';
  for (const char of value) out += FOLD.get(char) ?? char;
  return out;
}

/**
 * The canonical key for `value`. Two names with the same key are the same name.
 *
 * Idempotent: keying an already-keyed string returns it unchanged, so a stored key
 * and a freshly computed one compare directly.
 *
 * NEITHER `toLowerCase()` NOR `toLocaleLowerCase()` — both are wrong here, for different
 * reasons. The locale variant is locale-sensitive outright: the Turkish dotless-i rule would
 * key the same name differently on two machines, which for a value carrying a unique index
 * means a duplicate that inserts on one and is refused on the other. The plain one folds all
 * of Unicode, which the SQL side cannot do without `lower()` — CTYPE-dependent, and under a
 * `C` ctype it folds ASCII only. So the fold is ENUMERATED on both sides (`foldCase` here,
 * `translate()` there) and the two agree by construction rather than by coincidence on one
 * image.
 */
export function canonicalNameKey(value: string): string {
  return (
    foldCase(value)
      .replace(DIACRITICS, '')
      .replace(TATWEEL, '')
      .replace(ALEF_VARIANTS, 'ا')
      .replace(ALEF_MAQSURA, 'ي')
      .replace(TEH_MARBUTA, 'ه')
      .replace(NON_WORD, ' ')
      // A literal space run, matching the SQL split: everything else has already become a
      // space, and `\s` is CTYPE-dependent on the other side.
      .split(' ')
      .filter(Boolean)
      .map((token) => token.replace(DEFINITE_ARTICLE, ''))
      .filter(Boolean)
      .sort()
      .join(' ')
  );
}

/** True when two names are the same name. A convenience over two `canonicalNameKey`
 *  calls, so a call site reads as the question it is asking. */
export function isSameName(a: string, b: string): boolean {
  return canonicalNameKey(a) === canonicalNameKey(b);
}
