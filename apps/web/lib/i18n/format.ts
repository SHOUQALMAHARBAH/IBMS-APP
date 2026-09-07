import type { Language } from './translations';

// Part F — Bilingual UI (backlog Part 11), item #5: "Locale-aware number/
// date/currency formatting." Scoped to number/date formatting only — Hijri
// calendar support and real multi-currency (JOD base + reinsurance) are
// explicitly deferred, separate future work (see
// ibms-brain/meta/context/bilingual-ui.md's "What item #5 covers/does NOT
// cover"). This is the shared primitive every previously-duplicated
// `money()`/`fmtMoney()`/date formatter across ~25 files now routes through
// (the same "fix the shared primitive once" precedent items #2/#3 used for
// `app.styles.ts`/`ProfileField`), replacing every `toLocaleString(undefined,
// ...)`/`toLocaleDateString()` call that silently deferred to the browser's
// own runtime locale instead of this app's own `LanguagePreference`.
//
// Locale tags empirically verified against Node's ICU (the same engine web
// unit tests run on) before choosing them — see the two constants below.

/** Bare `'ar'`, not `'ar-JO'` — a full region tag switches to Eastern
 *  Arabic-Indic numerals (٠١٢٣...), a real visual change from the Western
 *  digits this app uses everywhere else (reference numbers, policy numbers).
 *  Both give Gregorian-calendar dates; neither defaults to Hijri. */
const AR_LOCALE = 'ar';

/** `'en-GB'`, not `'en'`/`'en-US'` — gives DD/MM/YYYY dates, matching this
 *  codebase's own existing precedent (`audit-anomaly-detection.service.ts`
 *  already uses `'en-GB'`) and the convention a Jordan/CBJ-regulated
 *  business context expects, rather than US-style MM/DD/YYYY. */
const EN_LOCALE = 'en-GB';

const LOCALE_BY_LANGUAGE: Record<Language, string> = {
  AR: AR_LOCALE,
  EN: EN_LOCALE,
};

/** Formats a JOD-fils-precision (3dp) amount for DISPLAY, locale-aware.
 *  Mirrors the exact null/non-finite handling every duplicated `money()`
 *  implementation already had (`null` → em dash, a non-numeric string
 *  passed through raw with the currency prefix) — a behavior-preserving
 *  consolidation, not a new contract. Not for persistence/logging — that's
 *  `apps/api`'s own `money.util.ts#formatMoney()`, a separate concern. */
export function formatMoney(
  value: string | null,
  language: Language,
  currency = 'JOD',
): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n)
    ? `${currency} ${n.toLocaleString(LOCALE_BY_LANGUAGE[language], {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      })}`
    : `${currency} ${value}`;
}

/** Locale-aware `Date.prototype.toLocaleDateString()` replacement. */
export function formatDate(value: string | Date, language: Language): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString(LOCALE_BY_LANGUAGE[language]);
}

/** Locale-aware `Date.prototype.toLocaleString()` replacement (date + time). */
export function formatDateTime(value: string | Date, language: Language): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString(LOCALE_BY_LANGUAGE[language]);
}
