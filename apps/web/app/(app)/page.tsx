'use client';

import { useEffect } from 'react';
import { ENUM_LABEL } from '../../lib/i18n/enum-labels';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { pageStyle } from '../../components/lead/lead.styles';
import {
  homeCardBlurbStyle,
  homeCardStyle,
  homeGridStyle,
  homeGroupHeadingStyle,
} from '../../components/app/app.styles';
import { canReach, DESTINATION_GROUPS, SECURITY } from '../../components/app/destinations';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';

/**
 * The launcher shows what THIS user can actually open, taken from the one destination catalogue and
 * filtered by the one visibility rule (`components/app/destinations.ts`).
 *
 * It used to be a hard-coded list of six cards with NO permission check. Measured on the office
 * administrator: four of the six answered 403 for her — leads, prospects, customers, the KYC queue —
 * and the three screens she could actually use (roles, users, employees) had no card at all. She
 * concluded the role-management screen did not exist. It does, and it works; nothing pointed at it,
 * and the first screen after login pointed at four things she could not do.
 *
 * Grouped in the catalogue's declaration order rather than the sidebar's per-role order: the
 * sidebar's hoisting exists to put a role's daily screen at the top of a long rail, and a launcher
 * that reorders itself per role makes the two surfaces disagree about where things are. If that
 * turns out to matter, move `navOrderFor` into the shared module and use it in both — do not grow a
 * second ordering here.
 */
const BLURBS: Partial<Record<string, TranslationKey>> = {
  '/leads': 'homeLeadsBlurb',
  '/prospects': 'homeProspectsBlurb',
  '/customers': 'homeCustomersBlurb',
  '/customers/kyc-queue': 'homeKycQueueBlurb',
  '/access-recertification': 'homeAccessRecertBlurb',
  '/settings/security': 'homeSecurityBlurb',
  // The three an administrator holds and had no card for.
  '/settings/roles': 'homeRolesBlurb',
  '/settings/users': 'homeUsersBlurb',
  '/employees': 'homeEmployeesBlurb',
  '/settings/org-units': 'homeOrgUnitsBlurb',
};

export default function HomePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  // Every group the user can see, carrying only the destinations they can open. `SECURITY` is
  // appended because it is ungated and belongs to no group — the same treatment the sidebar gives
  // it, and the reason a user owing MFA enrolment always has somewhere to go.
  const moduleGroups = DESTINATION_GROUPS.map((group) => ({
    labelKey: group.labelKey,
    items: group.items.filter((d) => canReach(user, d)),
  })).filter((group) => group.items.length > 0);

  // The account group is appended unconditionally, because `SECURITY` is ungated on purpose: a user
  // who owes MFA enrolment, or whose role grants nothing at all, must still have somewhere to go.
  // So "nothing to show" is a question about the MODULE groups — keying the empty state on the full
  // list made it unreachable, which is what the zero-permission test caught.
  const groups = [
    ...moduleGroups,
    { labelKey: 'navGroupAccount' as const, items: [SECURITY] },
  ];

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

      {moduleGroups.length === 0 ? (
        // Reachable in one real state: an account with a role that grants nothing, which the Role
        // screen can now produce deliberately. Saying so beats an empty page that looks broken.
        <p role="status">{t('homeNoDestinations')}</p>
      ) : null}
      {groups.map((group) => (
          <section key={group.labelKey} style={{ marginTop: '1.75rem' }}>
            <h2 style={homeGroupHeadingStyle}>{t(group.labelKey)}</h2>
            <div style={homeGridStyle}>
              {group.items.map((d) => {
                const blurb = BLURBS[d.href];
                return (
                  <Link key={d.href} href={d.href} style={homeCardStyle} data-home-card={d.href}>
                    <strong>{t(d.labelKey)}</strong>
                    {blurb ? <span style={homeCardBlurbStyle}>{t(blurb)}</span> : null}
                  </Link>
                );
              })}
            </div>
        </section>
      ))}
    </main>
  );
}
