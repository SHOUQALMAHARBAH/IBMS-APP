/**
 * Initials for the avatar in the navbar.
 *
 * Deliberately script-agnostic. The obvious implementation — match `[A-Z]`, or
 * uppercase the result — produces an EMPTY avatar for every Arabic name in the
 * system, which is most of them: Arabic is unicameral, so there is no
 * uppercase to find and nothing to uppercase.
 *
 * So this takes the first character of the first and last name tokens as they
 * are written. For "Branch Manager" that is BM; for "أحمد الهاشمي" it is أا —
 * the first letters of the given and family names, which is what a reader of
 * either script expects.
 */

/** Everything the Unicode standard calls a space, not just U+0020: Arabic text
 *  routinely carries no-break and zero-width joiners around names. */
const SPLIT = /[\s ​-‍⁠]+/u;

export function initialsFrom(fullName: string): string {
  const tokens = fullName.trim().split(SPLIT).filter(Boolean);
  if (tokens.length === 0) return '';

  // Array.from, not [0], so an astral character (or a name that opens with an
  // emoji-like code point) is not sliced in half into a lone surrogate.
  const first = Array.from(tokens[0])[0] ?? '';
  if (tokens.length === 1) return first;

  const last = Array.from(tokens[tokens.length - 1])[0] ?? '';
  return `${first}${last}`;
}
