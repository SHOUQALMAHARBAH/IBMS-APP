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
/** Anything that is not a letter, a digit or a space becomes a separator, so
 *  "Motor (Comprehensive)" and "Motor — Comprehensive" fold together. */
const NON_WORD = /[^\p{L}\p{N}\s]/gu;
/** The Arabic definite article at the head of a token. Three letters minimum
 *  after it, so a short word that merely begins with those letters is left
 *  alone. */
const DEFINITE_ARTICLE = /^ال(?=[؀-ۿ]{3,})/;

/**
 * The canonical key for `value`. Two names with the same key are the same name.
 *
 * Idempotent: keying an already-keyed string returns it unchanged, so a stored key
 * and a freshly computed one compare directly.
 *
 * `toLowerCase()` and not `toLocaleLowerCase()`, deliberately: the latter is
 * locale-sensitive, and the Turkish dotless-i rule would make the same name key
 * differently depending on the server's locale — which, for a value that carries a
 * unique index, would mean a duplicate that inserts on one machine and refuses on
 * another.
 */
export function canonicalNameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(ALEF_VARIANTS, 'ا')
    .replace(ALEF_MAQSURA, 'ي')
    .replace(TEH_MARBUTA, 'ه')
    .replace(NON_WORD, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(DEFINITE_ARTICLE, ''))
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** True when two names are the same name. A convenience over two `canonicalNameKey`
 *  calls, so a call site reads as the question it is asking. */
export function isSameName(a: string, b: string): boolean {
  return canonicalNameKey(a) === canonicalNameKey(b);
}
