'use client';

import { useEffect } from 'react';
import { ENUM_LABEL } from '../../lib/i18n/enum-labels';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { pageStyle } from '../../components/lead/lead.styles';
import { homeCardBlurbStyle, homeCardStyle, homeGridStyle } from '../../components/app/app.styles';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';

// Module scope has no translator, so each card carries its title and blurb
// KEYS and the component resolves them. Titles reuse the sidebar's own nav
// keys so a module is called the same thing in both places.
const MODULES: { href: string; titleKey: TranslationKey; blurbKey: TranslationKey }[] = [
  { href: '/leads', titleKey: 'navLeads', blurbKey: 'homeLeadsBlurb' },
  { href: '/prospects', titleKey: 'navProspects', blurbKey: 'homeProspectsBlurb' },
  { href: '/customers', titleKey: 'navCustomers', blurbKey: 'homeCustomersBlurb' },
  {
    href: '/customers/kyc-queue',
    titleKey: 'homeKycQueueTitle',
    blurbKey: 'homeKycQueueBlurb',
  },
  {
    href: '/access-recertification',
    titleKey: 'navAccessRecertification',
    blurbKey: 'homeAccessRecertBlurb',
  },
  { href: '/settings/security', titleKey: 'navSecurity', blurbKey: 'homeSecurityBlurb' },
];

export default function HomePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('homeWelcome', { name: user.fullName })}</h1>
      <p style={{ opacity: 0.8 }}>
        {t('homeSignedInAs', {
          roles:
            user.roles.length > 0
              ? user.roles
                  // A role an office defines has no translation key, so it shows
                  // its own name. `/auth/me` returns names for display only —
                  // authorization reads `permissions`.
                  .map((r) => {
                    const key =
                      ENUM_LABEL.RoleName[r as keyof typeof ENUM_LABEL.RoleName];
                    return key ? t(key) : r;
                  })
                  .join(', ')
              : t('homeNoRole'),
        })}
      </p>

      <div style={homeGridStyle}>
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href} style={homeCardStyle}>
            <strong>{t(m.titleKey)}</strong>
            <span style={homeCardBlurbStyle}>{t(m.blurbKey)}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
