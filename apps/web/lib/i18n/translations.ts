// Part F — Bilingual UI (backlog Part 11), item #1: "instant language switch
// ... + a persistent per-user language preference." This dictionary is
// deliberately small — it covers only the language switcher itself and the
// nav shell's account footer, enough to prove the switch mechanism round
// -trips end to end. Translating the rest of the app's ~80 screens is Part
// F's own items #2-5 (RTL layout, bidi text, Arabic-first input, locale
// formatting), not this item — see `ibms-brain/meta/context/bilingual-ui.md`.
export type Language = 'AR' | 'EN';

export const LANGUAGES: readonly Language[] = ['AR', 'EN'];

const translations = {
  AR: {
    language: 'اللغة',
    switchToArabic: 'العربية',
    switchToEnglish: 'English',
    signedInAs: 'تسجيل الدخول باسم',
    noRoleAssigned: 'لم يتم تعيين دور',
    signOut: 'تسجيل الخروج',
  },
  EN: {
    language: 'Language',
    switchToArabic: 'العربية',
    switchToEnglish: 'English',
    signedInAs: 'Signed in as',
    noRoleAssigned: 'No role assigned',
    signOut: 'Sign out',
  },
} as const;

export type TranslationKey = keyof (typeof translations)['EN'];

export function translate(language: Language, key: TranslationKey): string {
  return translations[language][key];
}
