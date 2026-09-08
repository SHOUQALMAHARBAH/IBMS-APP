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
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'AR'; // User.languagePreference's own schema default
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'EN' || stored === 'AR' ? stored : 'AR';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);
  const syncedFromAccountRef = useRef(false);

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

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
