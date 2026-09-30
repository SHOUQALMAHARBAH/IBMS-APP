import { lookupOptional, type Language } from '../i18n/translations';
import { permissionDescriptionKey } from '../i18n/permission-key';

/**
 * One short line per permission, saying what holding it ALLOWS.
 *
 * The owner's finding, from using the screen: **a code is not an explanation.** `claim.delete` tells a
 * broker nothing about what she is granting, and a matrix of 219 codes she cannot read is a matrix she
 * cannot use safely.
 *
 * ## The text lives in the DICTIONARY. This file is only the lookup.
 *
 * It used to hold a second bilingual map, `PERMISSION_DESCRIPTIONS`, keyed by code — user-facing text
 * outside `lib/i18n/translations/` and therefore outside every guard the dictionary has. That map is gone;
 * the lines are in `translations/permissions.ts` under `perm:<code>` keys, where AR/EN parity and
 * single-ownership are already enforced. `../i18n/permission-key.ts` owns the mapping in both directions
 * and explains why it is verbatim rather than transformed.
 *
 * ## The fallback is KEPT, and is unreachable by design rather than by accident
 *
 * A code with no line falls back to `Permission.description` — the stored, developer-facing English. Once
 * the coverage guard forbids a missing line that branch cannot be reached through the catalogue, and the
 * honest thing is to say which it is:
 *
 *   * it is KEPT because this function is also reachable with a code the CATALOGUE does not contain — a
 *     stale grant row, a code withdrawn between a page load and a render — and returning the stored hint
 *     beats returning nothing at all to someone deciding a grant;
 *   * it is PLANTED rather than assumed: `scripts/plants/permission-descriptions.json` has
 *     `fallback-is-reachable-from-the-catalogue`, which removes a line and proves the coverage guard
 *     catches it. Without that, "unreachable" would be a claim about code nobody had tested.
 *
 * Returning `null` rather than the code itself is deliberate: repeating the code beneath the code is noise
 * that looks like an explanation.
 */
export function describePermission(
  code: string,
  language: Language,
  storedDescription?: string,
): string | null {
  const key = permissionDescriptionKey(code);
  // `lookupOptional` rather than `translate()`: translate takes a `TranslationKey` so a typo cannot reach
  // it, and this key is built from a code that arrives from the API. It returns `undefined` for a key the
  // dictionary does not hold, where a cast would claim `string`.
  const written = lookupOptional(language, key);
  if (written !== undefined && written.trim().length > 0) return written;
  const stored = storedDescription?.trim();
  return stored && stored.length > 0 ? stored : null;
}

/** Whether a written line exists — used by the coverage guard to report the gap rather than hide it. */
export function hasWrittenDescription(code: string): boolean {
  const key = permissionDescriptionKey(code);
  const ar = lookupOptional('AR', key);
  const en = lookupOptional('EN', key);
  return (
    ar !== undefined &&
    ar.trim().length > 0 &&
    en !== undefined &&
    en.trim().length > 0
  );
}
