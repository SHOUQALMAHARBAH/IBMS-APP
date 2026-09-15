'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/auth-context';
import { updateLanguagePreference as patchLanguagePreference } from '../auth/auth-api';
import { translate, type Language, type TranslationKey } from './translations';
import { translatePlural, type PluralKey } from './plurals';

// Part F — Bilingual UI, item #1. "Instant" means the UI flips the moment a
// user picks a language — never waiting on the network — so `setLanguage`
// updates local state (and <html lang/dir>, and localStorage) synchronously
// and fires the persistence PATCH in the background, best-effort (the
// SlaTimer-start / SLA-resolve precedent used everywhere else in this app:
// the local action has already succeeded, a remote-persistence failure is
// logged, never surfaced as if the switch itself failed).
//
// localStorage is a per-device, pre-auth-resolution GUESS only — a fast,
// flash-reducing first paint before `GET /auth/me` resolves. The ACCOUNT'S
// own `languagePreference` (from `useAuth()`) is the source of truth and
// wins once, on first load, per session (`syncedFromAccountRef`) — a
// mid-session manual switch is never silently overwritten by a stale
// re-render of the same already-fetched `user` object.
const STORAGE_KEY = 'ibms.languagePreference';

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  /** Plural-aware sibling of `t`. Separate key union, and `count` is
   *  mandatory — the category is selected from it, so it is not optional the
   *  way `params` is. See `./plurals.ts`. */
  tPlural: (
    key: PluralKey,
    count: number,
    params?: Record<string, string | number>,
  ) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/** `User.languagePreference`'s own schema default, and the ONLY value the
 *  server can render: it has no localStorage and no locale cookie to read. */
const SSR_LANGUAGE: Language = 'AR';

function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return SSR_LANGUAGE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'EN' || stored === 'AR' ? stored : SSR_LANGUAGE;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Deliberately NOT `useState(readStoredLanguage)`. That initialiser runs
  // during the first client render, where it can return 'EN' from
  // localStorage while the server — which cannot see localStorage — rendered
  // 'AR'. React then finds the two trees disagree and throws away the
  // server HTML: "Hydration failed because the server rendered text didn't
  // match the client", on every string a pre-auth page translates.
  //
  // It stayed invisible while the four `(auth)` screens were hard-coded
  // English, because then both sides rendered the same literal regardless of
  // the language state. The moment they started calling `t()` the divergence
  // became visible on the very first screen anyone sees.
  //
  // So the first render always matches the server, and the stored preference
  // is adopted immediately afterwards, in an effect.
  const [language, setLanguageState] = useState<Language>(SSR_LANGUAGE);
  const syncedFromAccountRef = useRef(false);

  useEffect(() => {
    // Mount only. The account's own preference, when it arrives below, wins
    // over this — so if `/auth/me` somehow resolved first, don't undo it.
    if (syncedFromAccountRef.current) return;
    const stored = readStoredLanguage();
    setLanguageState((current) => (stored === current ? current : stored));
  }, []);

  useEffect(() => {
    if (user && !syncedFromAccountRef.current) {
      syncedFromAccountRef.current = true;
      setLanguageState(user.languagePreference);
      window.localStorage.setItem(STORAGE_KEY, user.languagePreference);
    }
  }, [user]);

  useEffect(() => {
    // `<html lang="en">` in the root layout has no way to know the account's
    // preference at SSR time (no locale cookie/middleware exists yet — a
    // real, documented limitation, not this item's scope); this is the
    // client-side correction, the same "instant, client-only DOM update"
    // shape `suppressHydrationWarning` on that element already anticipates.
    document.documentElement.lang = language.toLowerCase();
    document.documentElement.dir = language === 'AR' ? 'rtl' : 'ltr';
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    patchLanguagePreference(next).catch((err: unknown) => {
      // Best-effort: the switch already happened locally; only the
      // account-level persistence failed (e.g. a dropped request). The next
      // successful switch (or the next login elsewhere) will retry it.
      console.warn('Failed to persist language preference:', err);
    });
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(language, key, params),
    [language],
  );

  const tPlural = useCallback(
    (
      key: PluralKey,
      count: number,
      params?: Record<string, string | number>,
    ) => translatePlural(language, key, count, params),
    [language],
  );

  const value = useMemo(
    () => ({ language, setLanguage, t, tPlural }),
    [language, setLanguage, t, tPlural],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
