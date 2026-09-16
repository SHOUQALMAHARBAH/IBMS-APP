'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import {
  applyTheme,
  getThemeServerSnapshot,
  getThemeSnapshot,
  setThemePreference,
  subscribeTheme,
} from '../../lib/theme/theme-preference';
import { navbarToggleActiveStyle, navbarToggleStyle } from './app.styles';

/*
 * Light / dark, two visible states.
 *
 * There is deliberately no "system" button. Everyone starts on system — that
 * is what the absence of a stored value means, and it is how the app behaved
 * before this existed — so the state is reachable by default rather than by
 * choosing it. Adding a third button would give the majority of users a
 * control whose only purpose is to return them to where they already are.
 *
 * Which of the two reads as pressed while on `system` is decided by the OS,
 * not by the stored value: a user following a dark OS should see the dark
 * button lit, because that is what they are looking at.
 */
export function ThemeToggle() {
  const { t } = useLanguage();
  const preference = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );

  useEffect(() => {
    // Syncing an external system (the DOM) with React state — an effect's
    // actual job, and the same shape LanguageProvider uses for <html lang/dir>.
    applyTheme(preference);
  }, [preference]);

  // On `system` the media query is in charge, so ask the browser what it
  // resolved to rather than guessing from the stored value.
  const systemIsDark =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const effective = preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference;

  return (
    <div role="group" aria-label={t('themeLabel')} style={{ display: 'flex', gap: 'var(--space-1)' }}>
      <button
        type="button"
        aria-pressed={effective === 'light'}
        onClick={() => setThemePreference('light')}
        style={effective === 'light' ? navbarToggleActiveStyle : navbarToggleStyle}
      >
        {t('themeLight')}
      </button>
      <button
        type="button"
        aria-pressed={effective === 'dark'}
        onClick={() => setThemePreference('dark')}
        style={effective === 'dark' ? navbarToggleActiveStyle : navbarToggleStyle}
      >
        {t('themeDark')}
      </button>
    </div>
  );
}
