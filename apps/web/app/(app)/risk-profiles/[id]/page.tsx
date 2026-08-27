'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { RiskSurvey } from '../../../../components/risk-profile/RiskSurvey';
import type { RiskProfileWithSurvey } from '../../../../lib/risk-profile/risk-profile-api';
import { pageStyle } from '../../../../components/lead/lead.styles';

const CAN_EDIT_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
];

export default function RiskProfileSurveyPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();

  const [profile, setProfile] = useState<RiskProfileWithSurvey | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  const canEdit = user.roles.some((role) => CAN_EDIT_ROLES.includes(role));

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
        ← Back to sites
      </button>

      <h1>Risk survey{profile?.siteLabel ? ` — ${profile.siteLabel}` : ''}</h1>
      {profile?.priorClaimsHistorySummary ? (
        <p style={{ opacity: 0.8 }}>
          Prior claims: {profile.priorClaimsHistorySummary}
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
