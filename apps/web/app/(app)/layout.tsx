'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { AppNav } from '../../components/app/AppNav';
import { AppNavbar } from '../../components/app/AppNavbar';
import {
  contentStyle,
  mfaBannerBodyStyle,
  mfaBannerCtaStyle,
  mfaBannerStyle,
  mfaBannerTitleStyle,
  shellRowStyle,
  shellStyle,
} from '../../components/app/app.styles';

const SECURITY_PATH = '/settings/security';

// Wraps every authenticated screen (`app/(app)/*`) in the sidebar shell and
// gates the whole subtree on a session. Each child page still runs its own
// identical redirect guard — this one keeps the shell itself from flashing
// for a signed-out visitor before that guard fires.
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const { user, isLoading } = useAuth();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  /*
   * THE SCROLL RESET, WHICH IS THE DEFECT THE SHELL CHANGE WOULD OTHERWISE INTRODUCE.
   *
   * The browser restores and resets scroll on the DOCUMENT scroller. The content column is the
   * scroller now, so without this, navigating from halfway down a long table lands you halfway
   * down the next screen — with its page header, its one line saying what the screen is for, and
   * its primary action all above the fold. Invisible in every screenshot; obvious to the first
   * person who uses it, which is why `shell-scroll.spec.ts` asserts it.
   *
   * `scrollTop = 0` rather than `scrollTo({ behavior: 'smooth' })`: a route change is not a
   * movement within a page, and animating it would show the reader the bottom of a screen they
   * never asked for on the way up.
   */
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [pathname]);

  if (isLoading || !user) return null;

  // The signpost a measured first sign-in showed was missing entirely. `MfaRequiredGuard` refuses
  // every route but this one until an authenticator is paired, and each screen reports that refusal
  // as its own 403 — which reads as a permissions problem. Shown on `mfaEnabled === false` rather
  // than on `mfaPolicySatisfied`, because that second flag also carries the hardware-token half,
  // which no role can satisfy while WebAuthn is unbuilt: keying on it would leave a permanent
  // banner telling people to do something they cannot do. Suppressed on Security itself, where the
  // page's own status line says the same thing beside the button that fixes it.
  const needsEnrolment = !user.mfaEnabled && pathname !== SECURITY_PATH;

  return (
    <div style={shellStyle} data-app-shell>
      <AppNavbar />
      <div style={shellRowStyle} data-app-shell-row>
        <AppNav />
        <div style={contentStyle} data-app-content ref={contentRef}>
          {needsEnrolment ? (
            <div style={mfaBannerStyle} role="status" data-mfa-enrolment-banner>
              <strong style={mfaBannerTitleStyle}>{t('mfaBannerTitle')}</strong>
              <span style={mfaBannerBodyStyle}>{t('mfaBannerBody')}</span>
              <Link href={SECURITY_PATH} style={mfaBannerCtaStyle}>
                {t('mfaBannerCta')}
              </Link>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
