'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { ApiError, apiGet } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle, smallButtonStyle } from '../../../../components/lead/lead.styles';
import { profileFieldLabelStyle, profileFieldValueStyle, profileGridStyle } from '../../../../components/prospect/prospect.styles';

interface PolicyDetail {
  id: string;
  policyNumber: string | null;
  status: string;
  inceptionDate: string;
  customer?: {
    id: string;
    legalName: string;
  };
  recommendation?: {
    id: string;
    recommendedQuotation?: {
      premium: string;
    };
  };
  createdAt: string;
}

export default function PolicyDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading2, setIsLoading2] = useState(true);

  const load = useCallback(async () => {
    try {
      setIsLoading2(true);
      const response = await apiGet<PolicyDetail>(`/policies/${params.id}`);
      setPolicy(response);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? 'Not found'
          : err instanceof ApiError
            ? err.message
            : 'Please try again',
      );
    } finally {
      setIsLoading2(false);
    }
  }, [params.id, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user, load]);

  if (isLoading || !user) return null;

  if (isLoading2) {
    return (
      <div style={pageStyle}>
        <p>Loading...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={pageStyle}>
        <div style={errorStyle}>{loadError}</div>
        <button
          type="button"
          style={smallButtonStyle}
          onClick={() => router.push('/opportunities')}
        >
          Back to Opportunities
        </button>
      </div>
    );
  }

  if (!policy) {
    return (
      <div style={pageStyle}>
        <p>Not found</p>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <h1>Policy Details</h1>
      <div style={profileGridStyle}>
        <div>
          <div style={profileFieldLabelStyle}>Policy Number</div>
          <div style={profileFieldValueStyle}>
            <bdi>{policy.policyNumber ?? '—'}</bdi>
          </div>
        </div>
        <div>
          <div style={profileFieldLabelStyle}>Status</div>
          <div style={profileFieldValueStyle}>
            <bdi>{policy.status}</bdi>
          </div>
        </div>
        <div>
          <div style={profileFieldLabelStyle}>Inception Date</div>
          <div style={profileFieldValueStyle}>
            <bdi>{new Date(policy.inceptionDate).toLocaleDateString()}</bdi>
          </div>
        </div>
        {policy.customer && (
          <div>
            <div style={profileFieldLabelStyle}>Customer</div>
            <div style={profileFieldValueStyle}>
              <bdi>{policy.customer.legalName}</bdi>
            </div>
          </div>
        )}
        {policy.recommendation?.recommendedQuotation?.premium && (
          <div>
            <div style={profileFieldLabelStyle}>Premium</div>
            <div style={profileFieldValueStyle}>
              <bdi>{policy.recommendation.recommendedQuotation.premium}</bdi>
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        style={smallButtonStyle}
        onClick={() => router.push('/opportunities')}
      >
        Back to Opportunities
      </button>
    </div>
  );
}
