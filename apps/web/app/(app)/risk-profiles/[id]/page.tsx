'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { RiskSurvey } from '../../../../components/risk-profile/RiskSurvey';
import type { RiskProfileWithSurvey } from '../../../../lib/risk-profile/risk-profile-api';
import { pageStyle } from '../../../../components/lead/lead.styles';
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

  const canEdit = hasPermission(user, 'risk-profile.create');

  return (
    <main style={pageStyle}>
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
