import type { Language } from '../i18n/translations';

/**
 * One short line per permission, saying what holding it ALLOWS.
 *
 * The owner's finding, from using the screen: **a code is not an explanation.** `claim.delete` tells
 * a broker nothing about what she is granting, and a matrix of 186 codes she cannot read is a matrix
 * she cannot use safely.
 *
 * ## Why this file is nearly empty, deliberately
 *
 * The Arabic text is being written by the person who knows the business, for the owner's review —
 * not by me. Inventing 186 Arabic descriptions of regulatory permissions would produce confident,
 * plausible, wrong sentences about who may approve a refund or reveal a national ID, and nobody
 * downstream could tell which ones were guesses.
 *
 * So this is the SLOT and the wiring. `docs/permission-catalogue-for-descriptions.txt` is the input
 * that was handed over: all 186 codes grouped by their 12 modules, with the five-state families
 * marked. As lines arrive they are added here and appear on the screen with no further work.
 *
 * ## The fallback, and why it is not a translation
 *
 * Until a code has a line here, the screen shows the description already stored in the database
 * (`Permission.description`). That text is developer-facing and terse — it is a hint, not a
 * translation, and it is shown in either language precisely so that a missing Arabic line is
 * VISIBLY missing rather than silently absent.
 */
export interface PermissionDescription {
  ar: string;
  en: string;
}

/**
 * Keyed by permission code. Add entries; do not restructure.
 *
 * The three below are examples of the SHAPE that is wanted — what the person can then do, not the
 * code restated — and are marked so they are not mistaken for reviewed copy.
 */
export const PERMISSION_DESCRIPTIONS: Readonly<Record<string, PermissionDescription>> = {
  // EXAMPLES OF SHAPE — pending the owner's review, like every line that follows them will be.
  'role.read': {
    ar: 'الاطّلاع على أدوار المكتب وصلاحيات كل دور، دون تعديلها.',
    en: "See the office's roles and what each one grants, without changing them.",
  },
  'role.manage': {
    ar: 'إنشاء الأدوار وتعديل صلاحياتها وإيقافها أو حذفها.',
    en: 'Create roles, change what they grant, retire or delete them.',
  },
  'user.manage': {
    ar: 'إنشاء حسابات الدخول وإسناد الأدوار أو سحبها وتفعيل الحساب أو إلغاؤه.',
    en: 'Create login accounts, grant or revoke roles, activate or deactivate access.',
  },
};

/**
 * The line to show under a permission's checkbox, or `null` when there is nothing honest to show.
 *
 * `storedDescription` is `Permission.description` from the catalogue — the fallback. Returning
 * `null` rather than the code itself is deliberate: repeating the code beneath the code is noise
 * that looks like an explanation.
 */
export function describePermission(
  code: string,
  language: Language,
  storedDescription?: string,
): string | null {
  const written = PERMISSION_DESCRIPTIONS[code];
  if (written) return language === 'AR' ? written.ar : written.en;
  const stored = storedDescription?.trim();
  return stored && stored.length > 0 ? stored : null;
}

/** Whether a reviewed line exists — used by a test to report coverage rather than to hide the gap. */
export function hasWrittenDescription(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(PERMISSION_DESCRIPTIONS, code);
}
