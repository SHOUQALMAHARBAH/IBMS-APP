'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  listOpportunities,
  type Opportunity,
  type OpportunityStatus,
} from '../../../lib/opportunity/opportunity-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../components/lead/lead.styles';
import { rfqBadgeStyle, rfqCardStyle } from '../../../components/rfq/rfq.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate } from '../../../lib/i18n/format';
import type { TranslationKey } from '../../../lib/i18n/translations';

const OPPORTUNITY_STATUS_LABEL_KEY: Record<OpportunityStatus, TranslationKey> = {
  NEEDS_CONFIRMED: 'oppStatusNeedsConfirmed',
  RFQ_ISSUED: 'oppStatusRfqIssued',
  QUOTES_RECEIVED: 'oppStatusQuotesReceived',
  COMPARISON_BUILT: 'oppStatusComparisonBuilt',
  RECOMMENDATION_DRAFTED: 'oppStatusRecommendationDrafted',
  SENT_TO_CLIENT: 'oppStatusSentToClient',
  CLIENT_DECISION: 'oppStatusClientDecision',
  PLACEMENT: 'oppStatusPlacement',
  RENEGOTIATE: 'oppStatusRenegotiate',
  CLOSED_LOST: 'oppStatusClosedLost',
};

function OpportunitiesForCustomer({ customerId }: { customerId: string }) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOpportunities(await listOpportunities(customerId));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('oppListNoPermission')
          : err instanceof ApiError && err.status === 404
            ? t('oppCustomerNotFound')
            : err instanceof ApiError
              ? err.message
              : t('oppListLoadError'),
      );
    }
  }, [customerId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  if (loadError) {
    return (
      <p role="alert" style={errorStyle}>
        {loadError}
      </p>
    );
  }
  if (!opportunities) return <p>{t('commonLoading')}</p>;

  if (opportunities.length === 0) {
    return (
      <p style={{ opacity: 0.6, marginTop: '1rem' }}>{t('oppListNoneYet')}</p>
    );
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      {opportunities.map((opportunity) => (
        <button
          key={opportunity.id}
          type="button"
          style={rfqCardStyle}
          onClick={() => router.push(`/opportunities/${opportunity.id}`)}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <strong>{t('oppCardHeading', { id: opportunity.id.slice(0, 8) })}</strong>
            <span style={rfqBadgeStyle}>{t(OPPORTUNITY_STATUS_LABEL_KEY[opportunity.status])}</span>
          </div>
          <div style={cardMetaStyle}>
            {t('oppCreatedMeta', {
              type: t(opportunity.isRenewal ? 'oppRenewal' : 'oppNewBusiness'),
              date: formatDate(opportunity.createdAt, language),
            })}
          </div>
        </button>
      ))}
    </div>
  );
}

function OpportunitiesFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const customerId = searchParams.get('customerId') ?? '';

  if (!customerId) {
    return (
      <p role="alert" style={errorStyle}>
        {t('oppNoCustomerSelectedPrefix')}{' '}
        <button
          type="button"
          onClick={() => router.push('/customers')}
          style={{ textDecoration: 'underline', cursor: 'pointer' }}
        >
          {t('navCustomers')}
        </button>{' '}
        {t('oppNoCustomerSelectedSuffix')}
      </p>
    );
  }

  return <OpportunitiesForCustomer customerId={customerId} />;
}

export default function OpportunitiesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('oppListHeading')}</h1>
      <p style={{ opacity: 0.8 }}>{t('oppListIntro')}</p>
      <Suspense fallback={null}>
        <OpportunitiesFlow />
      </Suspense>
    </main>
  );
}
