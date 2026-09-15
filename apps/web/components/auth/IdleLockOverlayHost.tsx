'use client';

import { useAuth } from '../../lib/auth/auth-context';
import { IdleLockOverlay } from './IdleLockOverlay';

/**
 * Renders the idle-lock overlay from inside `LanguageProvider`.
 *
 * `AuthProvider` used to render the overlay itself, which put it OUTSIDE
 * `LanguageProvider` — and the provider order cannot simply be swapped,
 * because `LanguageProvider` reads `user.languagePreference` from
 * `useAuth()`. So the overlay could not be translated where it stood: the
 * moment it called `useLanguage()` it threw "useLanguage must be used within
 * a LanguageProvider", on every authenticated page.
 *
 * Mounting it here instead — a child of `LanguageProvider`, which is itself a
 * child of `AuthProvider` — gives it both contexts.
 */
export function IdleLockOverlayHost() {
  const { user, clearUser } = useAuth();
  return user ? <IdleLockOverlay user={user} onLockedOut={clearUser} /> : null;
}
