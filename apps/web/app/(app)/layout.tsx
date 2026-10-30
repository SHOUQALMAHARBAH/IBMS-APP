'use client';

import { useEffect, type ReactNode } from 'react';
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

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  /*
   * THERE IS NO SCROLL RESET HERE, AND THAT IS A MEASUREMENT RATHER THAN AN OMISSION.
   *
   * Moving the scroller off the document looks like it must stop route changes resetting the
   * scroll — the browser does that on the DOCUMENT scroller — so an effect was written for it,
   * `shell-scroll.spec.ts` was written to assert it, and then the effect was PLANTED AWAY. All
   * three tests still passed.
   *
   * MEASURED IN `next/dist/client/components/layout-router.js`: on a navigation with no hash the
   * App Router works out whether the new segment's node is in view, sets
   * `documentElement.scrollTop = 0`, and if the node is still out of view calls
   * `instance.scrollIntoView()` — which scrolls EVERY scrollable ancestor, this column included.
   * The framework has always done it; the document being the scroller was never what made it work.
   *
   * AND THE EFFECT WAS THE WORSE OF THE TWO, which is why it is gone rather than kept beside it.
   * It fired on `[pathname]`, which changes on a BACK navigation too, so it would have forced
   * `scrollTop = 0` and destroyed the position the reader was returning to. Next's path checks the
   * target state first and exits early when the node is already in view — exactly the Back case.
   *
   * `shell-scroll.spec.ts` pins the framework's behaviour instead, so a Next upgrade that stops
   * resetting a nested scroll container fails there rather than being found by a reader landing
   * halfway down a screen.
   */

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
        <div style={contentStyle} data-app-content>
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
