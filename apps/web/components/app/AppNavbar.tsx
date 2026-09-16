'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { logout } from '../../lib/auth/auth-api';
import { useLanguage } from '../../lib/i18n/language-context';
import { initialsFrom } from '../../lib/i18n/initials';
import {
  avatarStyle,
  navbarBrandStyle,
  navbarStyle,
  profileDeptStyle,
  profileMenuItemStyle,
  profileMenuStyle,
  profileNameStyle,
  profileSummaryStyle,
  navbarToggleActiveStyle,
  navbarToggleStyle,
  notificationsSlotStyle,
  trailingGroupStyle,
} from './app.styles';

/*
 * The top bar: wordmark at the leading edge, controls at the trailing edge.
 *
 * Full width, ABOVE the sidebar rather than only over the content column, so
 * the wordmark sits at the true leading edge of the screen. That is why
 * `brandStyle` left `AppNav` — two brand marks stacked diagonally is what the
 * alternative looks like.
 *
 * Leading/trailing rather than left/right throughout: the whole bar mirrors
 * under `dir="rtl"` for free, the same way `shellStyle`'s plain flex row
 * already mirrors the sidebar, with no per-element flipping.
 *
 * This is a SECOND <nav> landmark, so it carries its own accessible name.
 * Without one, `getByRole('navigation')` would be ambiguous between this and
 * the sidebar, for a screen-reader user as much as for a test.
 */
export function AppNavbar() {
  const router = useRouter();
  const { user, clearUser } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    // Subscribing to something outside React and closing on its events — the
    // shape `react-hooks/set-state-in-effect` explicitly allows, because the
    // setState happens in the callback rather than in the effect body.
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  if (!user) return null;

  const department =
    language === 'AR'
      ? (user.department?.nameAr ?? user.department?.name ?? null)
      : (user.department?.name ?? null);

  async function handleSignOut() {
    await logout();
    clearUser();
    router.push('/login');
  }

  return (
    <nav aria-label={t('navbarAria')} style={navbarStyle}>
      <Link href="/" style={navbarBrandStyle}>
        IBMS
      </Link>

      <div style={trailingGroupStyle}>
        {/*
          Reserved for the notifications system (backlog item 1b) and nothing
          else yet. Deliberately NOT a <button>: an empty button takes focus,
          shows a focus ring and does nothing when pressed, which is precisely
          how a control reads as broken. `aria-hidden` keeps it out of the
          accessibility tree entirely — there is no control here to announce.
          When 1b lands this becomes a real button and gains focus, hover and a
          badge in one change.
        */}
        <span aria-hidden="true" style={notificationsSlotStyle}>
          🔔
        </span>

        <div role="group" aria-label={t('language')} style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <button
            type="button"
            aria-pressed={language === 'AR'}
            onClick={() => setLanguage('AR')}
            style={language === 'AR' ? navbarToggleActiveStyle : navbarToggleStyle}
          >
            {t('switchToArabic')}
          </button>
          <button
            type="button"
            aria-pressed={language === 'EN'}
            onClick={() => setLanguage('EN')}
            style={language === 'EN' ? navbarToggleActiveStyle : navbarToggleStyle}
          >
            {t('switchToEnglish')}
          </button>
        </div>

        <details
          ref={menuRef}
          open={menuOpen}
          onToggle={(e) => setMenuOpen(e.currentTarget.open)}
          style={{ position: 'relative' }}
        >
          <summary style={profileSummaryStyle}>
            {/* Initials, not a photo: User carries no avatar column. The helper
                is script-aware — a [A-Z] match would render an empty circle for
                every Arabic name in the system. */}
            <span aria-hidden="true" style={avatarStyle}>
              {initialsFrom(user.fullName)}
            </span>
            <span style={{ display: 'grid', minWidth: 0 }}>
              <span style={profileNameStyle}>{user.fullName}</span>
              {department ? <span style={profileDeptStyle}>{department}</span> : null}
            </span>
          </summary>

          <div style={profileMenuStyle}>
            <Link
              href="/settings/security"
              style={profileMenuItemStyle}
              onClick={() => setMenuOpen(false)}
            >
              {t('secChangePasswordButton')}
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              style={{ ...profileMenuItemStyle, width: '100%', textAlign: 'start' }}
            >
              {t('signOut')}
            </button>
          </div>
        </details>
      </div>
    </nav>
  );
}
