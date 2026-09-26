import type { Language } from '../i18n/translations';

/**
 * One short line per permission, saying what holding it ALLOWS.
 *
 * The owner's finding, from using the screen: **a code is not an explanation.** `claim.delete` tells
 * a broker nothing about what she is granting, and a matrix of 216 codes she cannot read is a matrix
 * she cannot use safely.
 *
 * ## Why this file is nearly empty, deliberately
 *
 * The Arabic text is being written by the person who knows the business, for the owner's review —
 * not by me. Inventing 216 Arabic descriptions of regulatory permissions would produce confident,
 * plausible, wrong sentences about who may approve a refund or reveal a national ID, and nobody
 * downstream could tell which ones were guesses.
 *
 * So this is the SLOT and the wiring. `docs/permission-catalogue-for-descriptions.txt` is the input
 * that was handed over, and it is now GENERATED (`npm run db:permission-descriptions`) rather than
 * hand-written: all 216 codes grouped by their 12 modules, with the five-state families marked, and
 * any line already written carried forward. As lines arrive they are added here and appear on the
 * screen with no further work.
 *
 * A code whose stored description opens `NOT YET ENFORCED` needs no line here — holding it does
 * nothing today and the screen says so, so an Arabic sentence describing it would describe a
 * capability that is not there. `permission-enforcement.inventory.spec.ts` keeps that list honest.
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
  // `role.manage` split into three in four-action Phase 1. Its Arabic line described all three at once,
  // so it cannot simply be copied onto each: "إنشاء الأدوار وتعديل صلاحياتها وإيقافها أو حذفها" is the
  // umbrella's sentence, and three narrower ones are three judgements about wording that belong to the
  // owner. The English is written here as the shape; the Arabic stays absent and therefore visibly
  // missing, which is this file's whole rule.
  'role.create': {
    ar: '',
    en: "Define a new role in the office's catalogue.",
  },
  'role.update': {
    ar: '',
    en: 'Rename a role, change what it grants, and set its MFA requirements.',
  },
  'role.deactivate': {
    ar: '',
    en: 'Retire a role, bring a retired one back, or delete one that was never used.',
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
