'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { listRfqs, type Rfq } from '../../../lib/rfq/rfq-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../components/lead/lead.styles';
import { rfqBadgeStyle, rfqCardStyle } from '../../../components/rfq/rfq.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate } from '../../../lib/i18n/format';

function RfqList({
  scope,
}: {
  scope: { opportunityId: string } | { customerId: string };
}) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [rfqs, setRfqs] = useState<Rfq[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const key = 'opportunityId' in scope ? scope.opportunityId : scope.customerId;

  const load = useCallback(async () => {
    try {
      setRfqs(await listRfqs(scope));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('rfqListNoPermission')
          : err instanceof ApiError && err.status === 404
            ? t('rfqListParentNotFound')
            : err instanceof ApiError
              ? err.message
              : t('rfqListLoadError'),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

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
  if (!rfqs) return <p>{t('commonLoading')}</p>;
  if (rfqs.length === 0) {
    return <p style={{ opacity: 0.6, marginTop: '1rem' }}>{t('rfqListNone')}</p>;
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      {rfqs.map((rfq) => (
        <button
          key={rfq.id}
          type="button"
          style={rfqCardStyle}
          onClick={() => router.push(`/rfqs/${rfq.id}`)}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <strong>
              <bdi>{rfq.insuranceLine}</bdi>
            </strong>
            <span style={rfqBadgeStyle}>
              {t(
                rfq.insurerSubmissions.length === 1 ? 'rfqInsurerCountOne' : 'rfqInsurerCountOther',
                { count: rfq.insurerSubmissions.length },
              )}
            </span>
          </div>
          <div style={cardMetaStyle}>
            {t('rfqListIssuedMeta', { date: formatDate(rfq.issuedAt, language) })}
          </div>
        </button>
      ))}
    </div>
  );
}

function RfqsFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const opportunityId = searchParams.get('opportunityId') ?? '';
  const customerId = searchParams.get('customerId') ?? '';

  if (opportunityId) return <RfqList scope={{ opportunityId }} />;
  if (customerId) return <RfqList scope={{ customerId }} />;

  return (
    <p role="alert" style={errorStyle}>
      {t('rfqListNoParentPrefix')}{' '}
      <button
        type="button"
        onClick={() => router.push('/opportunities')}
        style={{ textDecoration: 'underline', cursor: 'pointer' }}
      >
        {t('rfqListNoParentLinkLabel')}
      </button>
      .
    </p>
  );
}

export default function RfqsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('rfqListHeading')}</h1>
      <Suspense fallback={null}>
        <RfqsFlow />
      </Suspense>
    </main>
  );
}
