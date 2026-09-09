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
      insurer?: { name: string };
      deductible?: string;
      commission?: string;
    };
  };
  createdAt: string;
  updatedAt: string;
}

const STATUS_KEY_MAP: Record<string, string> = {
  PLACEMENT_REQUESTED: 'policyStatusPlacementRequested',
  PLACEMENT_CONFIRMED: 'policyStatusPlacementConfirmed',
  ISSUED: 'policyStatusIssued',
  CHECKED: 'policyStatusChecked',
  DELIVERED: 'policyStatusDelivered',
  CANCELLED: 'policyStatusCancelled',
  EXPIRED: 'policyStatusExpired',
};

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
  }, [params.id]);

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
        <p>{t('commonLoading')}</p>
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
          {t('commonBack')}
        </button>
      </div>
    );
  }

  if (!policy) {
    return (
      <div style={pageStyle}>
        <p>{t('commonNotFound')}</p>
      </div>
    );
  }

  const statusKey = STATUS_KEY_MAP[policy.status] || policy.status;
  const displayStatus = statusKey.startsWith('policy') ? t(statusKey as any) : policy.status;

  return (
    <div style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>
        {t('policySectionHeading')} {policy.policyNumber && `— ${policy.policyNumber}`}
      </h1>

      {/* Core Policy Information */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
          {t('commonDetails')}
        </h2>
        <div style={profileGridStyle}>
          {policy.policyNumber && (
            <div>
              <div style={profileFieldLabelStyle}>{t('policyNumber')}</div>
              <div style={profileFieldValueStyle}>
                <bdi dir="ltr">{policy.policyNumber}</bdi>
              </div>
            </div>
          )}

          <div>
            <div style={profileFieldLabelStyle}>{t('commonStatus')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{displayStatus}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('policyInceptionDate')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(policy.inceptionDate).toLocaleDateString()}</bdi>
            </div>
          </div>

          {policy.customer && (
            <div>
              <div style={profileFieldLabelStyle}>{t('customerLabel')}</div>
              <div style={profileFieldValueStyle}>
                <bdi>{policy.customer.legalName}</bdi>
              </div>
            </div>
          )}

          <div>
            <div style={profileFieldLabelStyle}>{t('commonCreatedAt')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(policy.createdAt).toLocaleDateString()}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('commonUpdatedAt')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(policy.updatedAt).toLocaleDateString()}</bdi>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendation & Commercial Terms */}
      {policy.recommendation?.recommendedQuotation && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
            {t('policyCommercialTerms')}
          </h2>
          <div style={profileGridStyle}>
            {policy.recommendation.recommendedQuotation.insurer && (
              <div>
                <div style={profileFieldLabelStyle}>{t('commonInsurer')}</div>
                <div style={profileFieldValueStyle}>
                  <bdi>{policy.recommendation.recommendedQuotation.insurer.name}</bdi>
                </div>
              </div>
            )}

            <div>
              <div style={profileFieldLabelStyle}>{t('policyPremium')}</div>
              <div style={profileFieldValueStyle}>
                <bdi>{policy.recommendation.recommendedQuotation.premium}</bdi>
              </div>
            </div>

            {policy.recommendation.recommendedQuotation.deductible && (
              <div>
                <div style={profileFieldLabelStyle}>{t('policyDeductible')}</div>
                <div style={profileFieldValueStyle}>
                  <bdi>{policy.recommendation.recommendedQuotation.deductible}</bdi>
                </div>
              </div>
            )}

            {policy.recommendation.recommendedQuotation.commission && (
              <div>
                <div style={profileFieldLabelStyle}>{t('policyCommission')}</div>
                <div style={profileFieldValueStyle}>
                  <bdi>{policy.recommendation.recommendedQuotation.commission}</bdi>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        style={smallButtonStyle}
        onClick={() => router.push('/opportunities')}
      >
        {t('commonBack')}
      </button>
    </div>
  );
}
