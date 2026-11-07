'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { RiskSurvey } from '../../../../components/risk-profile/RiskSurvey';
import type { RiskProfileWithSurvey } from '../../../../lib/risk-profile/risk-profile-api';
import {

} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { hasPermission } from '../../../../lib/auth/permissions';
import { useLanguage } from '../../../../lib/i18n/language-context';


export default function RiskProfileSurveyPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [profile, setProfile] = useState<RiskProfileWithSurvey | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  /*
   * ROW 12 — `risk-profile.update`, NOT `.create`. Fixed 2026-11-06 (module 0-c batch 6b).
   *
   * This read `risk-profile.create` and is passed to `<RiskSurvey canEdit>`, where it gates the
   * asset add / edit / delete controls — and all THREE of those routes enforce
   * `risk-profile.update` (`risk-profile.controller.ts` :66 :78 :90). `.create` guards one route,
   * `POST /risk-profiles`, which this screen does not call at all.
   *
   * BOTH DIRECTIONS WERE WRONG AT ONCE, which is what makes a mismatch worth fixing rather than
   * tidying: a role holding `.update` and not `.create` could not SEE the controls it is entitled
   * to use, and a role holding `.create` and not `.update` saw them and was answered 403.
   *
   * INVISIBLE UNDER THE SEED, and that is why it survived: measured 2026-11-06, both codes are
   * granted to exactly `[SALES, PLACEMENT]`, so no seeded role can tell them apart. It goes live
   * the first time an office defines a role holding one — which is the whole point of
   * office-scoped RBAC.
   *
   * NOT widened to `hasAnyPermission([create, update])`: that would offer the control to a holder
   * of `.create` who the route still refuses, which is the same defect wearing a fix.
   */
  const canEdit = hasPermission(user, 'risk-profile.update');

  return (
    <main style={pageStackStyle}>
      <button
        type="button"
        onClick={() =>
          router.push(
            profile
              ? `/risk-profiles?customerId=${profile.customerId}`
              : '/risk-profiles',
          )
        }
        style={{ cursor: 'pointer' }}
      >
        {t('rpdBackToSites')}
      </button>

      <h1>
        {profile?.siteLabel
          ? t('rpdHeadingWithSite', { site: profile.siteLabel })
          : t('rpdHeading')}
      </h1>
      {profile?.priorClaimsHistorySummary ? (
        <p style={{ opacity: 0.8 }}>
          {t('rpdPriorClaims', { summary: profile.priorClaimsHistorySummary })}
        </p>
      ) : null}

      <RiskSurvey
        riskProfileId={params.id}
        canEdit={canEdit}
        onLoaded={setProfile}
      />
    </main>
  );
}
