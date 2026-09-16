import type { Language } from './translations';
import { formatNumber, LOCALE_BY_LANGUAGE } from './format';

// Plural-aware copy.
//
// `translate()` resolves a key to ONE string. That is correct for every
// string whose wording does not change with a number, which is almost all of
// them — and wrong for the handful that do. Those were written as
// `count === 1 ? '' : 's'` in the component, a shape that cannot express
// Arabic at all: `Intl.PluralRules('ar')` selects between SIX categories
// (zero / one / two / few / many / other), where English selects between two.
// Hard-coding a ternary is not a shortcut for Arabic, it is a wrong answer
// for four of its six cases.
//
// So plural copy lives here, in its own namespace with its own key union,
// rather than inside the flat `TranslationKey` dictionary:
//
//   - a dictionary value is a `string`; a plural value is an object of forms.
//     Widening `translations` to `string | PluralForms` would make every
//     existing `t()` call site's return type a union, and would break the
//     merged-dictionary tests that assume `Record<string, string>`.
//   - `PluralKey` and `TranslationKey` stay separate unions, so `t()` cannot
//     silently resolve a plural key to "[object Object]" and `tPlural()`
//     cannot be handed a key that has no forms. Both are compile errors.
//
// The category comes from the platform, never from hand-rolled arithmetic:
// CLDR's rules are data, they differ per locale, and they change. Asking
// `Intl` is the only way to stay correct without shipping our own copy of
// that data.

export type PluralCategory =
  | 'zero'
  | 'one'
  | 'two'
  | 'few'
  | 'many'
  | 'other';

/** `other` is mandatory because CLDR guarantees it for every locale and every
 *  count — it is the fallback the resolver can always reach. Every other
 *  category is optional: English genuinely only needs `one`/`other`, and an
 *  Arabic string whose wording happens not to change between `many` and
 *  `other` should not be forced to repeat itself. */
export type PluralForms = { other: string } & Partial<
  Record<Exclude<PluralCategory, 'other'>, string>
>;

type PluralDictionary = Record<string, PluralForms>;

// Arabic noun-after-number agreement, which is what these forms encode:
//   0            لا + plural        (zero)
//   1            the bare noun      (one)
//   2            the dual           (two)
//   3-10         the broken plural  (few)
//   11-99        singular accusative(many)
//   100+         the bare singular  (other)
// English needs only `one` and `other`; anything else would be noise.

const AR: PluralDictionary = {
  brDetectLines: {
    zero: 'لا توجد أسطر',
    one: 'سطر واحد',
    two: 'سطران',
    few: '{count} أسطر',
    many: '{count} سطراً',
    other: '{count} سطر',
  },
  brDetectExceptions: {
    zero: 'لم تُثَر أي استثناءات',
    one: 'أُثير استثناء واحد',
    two: 'أُثير استثناءان',
    few: 'أُثيرت {count} استثناءات',
    many: 'أُثير {count} استثناءً',
    other: 'أُثير {count} استثناء',
  },
  dcmpBreachesOpen: {
    zero: 'لا شيء مفتوح',
    one: 'واحدة مفتوحة',
    two: 'اثنتان مفتوحتان',
    few: '{count} مفتوحة',
    many: '{count} مفتوحة',
    other: '{count} مفتوحة',
  },
  dpolRenewalWindowDays: {
    one: 'نافذة التجديد: يوم واحد.',
    two: 'نافذة التجديد: يومان.',
    few: 'نافذة التجديد: {count} أيام.',
    many: 'نافذة التجديد: {count} يوماً.',
    other: 'نافذة التجديد: {count} يوم.',
  },
  docsDocumentCount: {
    zero: 'لا توجد مستندات',
    one: 'مستند واحد',
    two: 'مستندان',
    few: '{count} مستندات',
    many: '{count} مستنداً',
    other: '{count} مستند',
  },
  frInvoiceCount: {
    zero: 'لا توجد فواتير',
    one: 'فاتورة واحدة',
    two: 'فاتورتان',
    few: '{count} فواتير',
    many: '{count} فاتورة',
    other: '{count} فاتورة',
  },
  frCustomerCount: {
    zero: 'لا يوجد عملاء',
    one: 'عميل واحد',
    two: 'عميلان',
    few: '{count} عملاء',
    many: '{count} عميلاً',
    other: '{count} عميل',
  },
  frInsurerCount: {
    zero: 'لا توجد شركات تأمين',
    one: 'شركة تأمين واحدة',
    two: 'شركتا تأمين',
    few: '{count} شركات تأمين',
    many: '{count} شركة تأمين',
    other: '{count} شركة تأمين',
  },
  iprogLineCount: {
    zero: 'لا توجد فروع',
    one: 'فرع واحد',
    two: 'فرعان',
    few: '{count} فروع',
    many: '{count} فرعاً',
    other: '{count} فرع',
  },
  naCoverageLinesRecommended: {
    zero: 'لم يُوصَ بأي فرع تأمين',
    one: 'أُوصي بفرع تأمين واحد',
    two: 'أُوصي بفرعَي تأمين',
    few: 'أُوصي بـ{count} فروع تأمين',
    many: 'أُوصي بـ{count} فرع تأمين',
    other: 'أُوصي بـ{count} فرع تأمين',
  },
  rpSiteCount: {
    zero: 'بلا مواقع',
    one: 'موقع واحد',
    two: 'موقعان',
    few: '{count} مواقع',
    many: '{count} موقعاً',
    other: '{count} موقع',
  },
  ropaExportedEntries: {
    zero: 'لم تُصدَّر أي سجلات.',
    one: 'صُدِّر سجل واحد.',
    two: 'صُدِّر سجلان.',
    few: 'صُدِّرت {count} سجلات.',
    many: 'صُدِّر {count} سجلاً.',
    other: 'صُدِّر {count} سجل.',
  },
  secIdleTimeoutMinutes: {
    one: 'مهلة الخمول: دقيقة واحدة',
    two: 'مهلة الخمول: دقيقتان',
    few: 'مهلة الخمول: {count} دقائق',
    many: 'مهلة الخمول: {count} دقيقة',
    other: 'مهلة الخمول: {count} دقيقة',
  },
  secHardLogoutMinutes: {
    one: 'تسجيل الخروج التلقائي بعد: دقيقة واحدة من الخمول',
    two: 'تسجيل الخروج التلقائي بعد: دقيقتين من الخمول',
    few: 'تسجيل الخروج التلقائي بعد: {count} دقائق من الخمول',
    many: 'تسجيل الخروج التلقائي بعد: {count} دقيقة من الخمول',
    other: 'تسجيل الخروج التلقائي بعد: {count} دقيقة من الخمول',
  },
  claimFilesOnRecord: {
    zero: 'لا توجد ملفات مسجّلة.',
    one: 'ملف واحد مسجّل.',
    two: 'ملفان مسجّلان.',
    few: '{count} ملفات مسجّلة.',
    many: '{count} ملفاً مسجّلاً.',
    other: '{count} ملف مسجّل.',
  },
  secOtherSessionsRevoked: {
    zero: 'لم تكن هناك جلسات أخرى.',
    one: 'أُنهيت جلسة واحدة أخرى.',
    two: 'أُنهيت جلستان أخريان.',
    few: 'أُنهيت {count} جلسات أخرى.',
    many: 'أُنهيت {count} جلسة أخرى.',
    other: 'أُنهيت {count} جلسة أخرى.',
  },
  navSearchMatches: {
    zero: 'لا توجد نتائج',
    one: 'نتيجة واحدة',
    two: 'نتيجتان',
    few: '{count} نتائج',
    many: '{count} نتيجة',
    other: '{count} نتيجة',
  },
  claimFollowUpBusinessDays: {
    one: 'لا استجابة من المؤمِّن بعد يوم عمل واحد من التسجيل',
    two: 'لا استجابة من المؤمِّن بعد يومَي عمل من التسجيل',
    few: 'لا استجابة من المؤمِّن بعد {count} أيام عمل من التسجيل',
    many: 'لا استجابة من المؤمِّن بعد {count} يوم عمل من التسجيل',
    other: 'لا استجابة من المؤمِّن بعد {count} يوم عمل من التسجيل',
  },
};

const EN: PluralDictionary = {
  brDetectLines: { one: '{count} line', other: '{count} lines' },
  brDetectExceptions: {
    one: '{count} exception raised',
    other: '{count} exceptions raised',
  },
  dcmpBreachesOpen: { other: '{count} open' },
  dpolRenewalWindowDays: {
    one: 'Renewal window: {count} day.',
    other: 'Renewal window: {count} days.',
  },
  docsDocumentCount: { one: '{count} document', other: '{count} documents' },
  frInvoiceCount: { one: '{count} invoice', other: '{count} invoices' },
  frCustomerCount: { one: '{count} customer', other: '{count} customers' },
  frInsurerCount: { one: '{count} insurer', other: '{count} insurers' },
  iprogLineCount: { one: '{count} line', other: '{count} lines' },
  naCoverageLinesRecommended: {
    one: '{count} coverage line recommended',
    other: '{count} coverage lines recommended',
  },
  rpSiteCount: { one: '{count} site', other: '{count} sites' },
  ropaExportedEntries: {
    one: 'Exported {count} entry.',
    other: 'Exported {count} entries.',
  },
  secIdleTimeoutMinutes: {
    one: 'Idle timeout: {count} minute',
    other: 'Idle timeout: {count} minutes',
  },
  secHardLogoutMinutes: {
    one: 'Automatic sign-out after: {count} minute idle',
    other: 'Automatic sign-out after: {count} minutes idle',
  },
  claimFilesOnRecord: {
    one: '{count} file on record.',
    other: '{count} files on record.',
  },
  secOtherSessionsRevoked: {
    one: '{count} other session was signed out.',
    other: '{count} other sessions were signed out.',
  },
  navSearchMatches: {
    one: '{count} match',
    other: '{count} matches',
  },
  claimFollowUpBusinessDays: {
    one: 'No insurer response {count} business day after registration',
    other: 'No insurer response {count} business days after registration',
  },
};

export const PLURALS = { AR, EN } as const;

/** Deliberately keyed off EN: it is the language every key must exist in, and
 *  `plurals.test.ts` asserts AR carries the same set. */
export type PluralKey = keyof typeof EN;

/** One resolver, so the `Intl.PluralRules` instances are built once per locale
 *  rather than once per render. Constructing one is not free, and these run
 *  inside list rendering. */
const RULES = new Map<string, Intl.PluralRules>();
function rulesFor(language: Language): Intl.PluralRules {
  const locale = LOCALE_BY_LANGUAGE[language];
  let r = RULES.get(locale);
  if (!r) {
    r = new Intl.PluralRules(locale);
    RULES.set(locale, r);
  }
  return r;
}

/**
 * Resolves `key` to the form matching `count` in `language`, then substitutes
 * `{count}` plus anything in `params`.
 *
 * The category comes from `Intl.PluralRules`, so Arabic genuinely selects
 * between its six forms and English between its two. When the selected
 * category has no form, it falls back to `other` — the one CLDR guarantees
 * exists — rather than to the nearest neighbour: a missing `many` is a gap in
 * the copy, and silently borrowing `few` would hide it behind a form that is
 * grammatically wrong for that count anyway.
 *
 * `{count}` is inserted through `toLocaleString` for the same locale, so a
 * four-figure count is grouped the way every other number on the screen is.
 */
export function translatePlural(
  language: Language,
  key: PluralKey,
  count: number,
  params?: Record<string, string | number>,
): string {
  const forms = PLURALS[language][key] as PluralForms;
  const category = rulesFor(language).select(count);
  const raw = forms[category] ?? forms.other;

  const withCount = raw.replaceAll('{count}', formatNumber(count, language));
  if (!params) return withCount;
  return Object.entries(params).reduce(
    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
    withCount,
  );
}
