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
    <div style={shellStyle}>
      <AppNavbar />
      <div style={shellRowStyle}>
        <AppNav />
        <div style={contentStyle}>
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
