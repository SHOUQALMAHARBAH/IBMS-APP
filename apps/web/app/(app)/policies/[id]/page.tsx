'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { policyStatusLabelKey } from '../../../../lib/policy/policy-status';
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
          ? (t('poldNotFound'))
          : err instanceof ApiError
            ? err.message
            : (t('poldPleaseTryAgain')),
      );
    } finally {
      setIsLoading2(false);
    }
  }, [params.id, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    // Deferred through an async IIFE so the first `setIsLoading` inside
    // `load` does not run synchronously in the effect body — the same
    // shape every other data-loading screen here uses (see
    // `app/(app)/customers/page.tsx`).
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  if (isLoading || !user) return null;

  if (isLoading2) {
    return (
      <div style={pageStyle}>
        <p>{t('poldLoading')}</p>
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
          {t('poldBackToList')}
        </button>
      </div>
    );
  }

  if (!policy) {
    return (
      <div style={pageStyle}>
        <p>{t('poldNotFound2')}</p>
      </div>
    );
  }

  // One shared, enum-exact mapping (lib/policy/policy-status.ts) rather than
  // the two local Record<string, string> maps this page used to carry. Those
  // listed PLACEMENT_REQUESTED and CHECKED — neither is a real PolicyStatus —
  // and omitted CHECKING_IN_PROGRESS, DISCREPANCY, VERIFIED and ACTIVE, so a
  // completed policy showed the literal token "ACTIVE" in both languages.
  const statusKey = policyStatusLabelKey(policy.status);
  const displayStatus = statusKey ? t(statusKey) : policy.status;

  return (
    <div style={pageStyle}>
      <h1 style={{ marginBottom: '1.5rem' }}>
        {t('poldPolicyDetails')} {policy.policyNumber && `— ${policy.policyNumber}`}
      </h1>

      {/* Core Policy Information */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
          {t('poldBasicInformation')}
        </h2>
        <div style={profileGridStyle}>
          {policy.policyNumber && (
            <div>
              <div style={profileFieldLabelStyle}>{t('poldPolicyNumber')}</div>
              <div style={profileFieldValueStyle}>
                <bdi dir="ltr">{policy.policyNumber}</bdi>
              </div>
            </div>
          )}

          <div>
            <div style={profileFieldLabelStyle}>{t('poldStatus')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{displayStatus}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('poldInceptionDate')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(policy.inceptionDate).toLocaleDateString(t('poldEnUs'))}</bdi>
            </div>
          </div>

          {policy.customer && (
            <div>
              <div style={profileFieldLabelStyle}>{t('poldCustomer')}</div>
              <div style={profileFieldValueStyle}>
                <bdi>{policy.customer.legalName}</bdi>
              </div>
            </div>
          )}

          <div>
            <div style={profileFieldLabelStyle}>{t('poldCreated')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(policy.createdAt).toLocaleDateString(t('poldEnUs2'))}</bdi>
            </div>
          </div>

          <div>
            <div style={profileFieldLabelStyle}>{t('poldUpdated')}</div>
            <div style={profileFieldValueStyle}>
              <bdi>{new Date(policy.updatedAt).toLocaleDateString(t('poldEnUs3'))}</bdi>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendation & Commercial Terms */}
      {policy.recommendation?.recommendedQuotation && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
            {t('poldCommercialTerms')}
          </h2>
          <div style={profileGridStyle}>
            {policy.recommendation.recommendedQuotation.insurer && (
              <div>
                <div style={profileFieldLabelStyle}>{t('poldInsurer')}</div>
                <div style={profileFieldValueStyle}>
                  <bdi>{policy.recommendation.recommendedQuotation.insurer.name}</bdi>
                </div>
              </div>
            )}

            <div>
              <div style={profileFieldLabelStyle}>{t('poldPremium')}</div>
              <div style={profileFieldValueStyle}>
                <bdi>{policy.recommendation.recommendedQuotation.premium}</bdi>
              </div>
            </div>

            {policy.recommendation.recommendedQuotation.deductible && (
              <div>
                <div style={profileFieldLabelStyle}>{t('poldDeductible')}</div>
                <div style={profileFieldValueStyle}>
                  <bdi>{policy.recommendation.recommendedQuotation.deductible}</bdi>
                </div>
              </div>
            )}

            {policy.recommendation.recommendedQuotation.commission && (
              <div>
                <div style={profileFieldLabelStyle}>{t('poldCommission')}</div>
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
        {t('poldBack')}
      </button>
    </div>
  );
}
