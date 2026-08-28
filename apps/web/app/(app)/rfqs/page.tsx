'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { listRfqs, type Rfq } from '../../../lib/rfq/rfq-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../components/lead/lead.styles';
import { rfqBadgeStyle, rfqCardStyle } from '../../../components/rfq/rfq.styles';

function RfqList({
  scope,
}: {
  scope: { opportunityId: string } | { customerId: string };
}) {
  const router = useRouter();
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
          ? "You don't hold the rfq.read permission, so there's nothing to show here."
          : err instanceof ApiError && err.status === 404
            ? 'That parent could not be found — it may not exist, or you may not have access to it.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load RFQs — try again.',
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
  if (!rfqs) return <p>Loading…</p>;
  if (rfqs.length === 0) {
    return <p style={{ opacity: 0.6, marginTop: '1rem' }}>No RFQs.</p>;
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
            <strong>{rfq.insuranceLine}</strong>
            <span style={rfqBadgeStyle}>
              {rfq.insurerSubmissions.length} insurer
              {rfq.insurerSubmissions.length === 1 ? '' : 's'}
            </span>
          </div>
          <div style={cardMetaStyle}>
            Issued {new Date(rfq.issuedAt).toLocaleDateString()}
          </div>
        </button>
      ))}
    </div>
  );
}

function RfqsFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const opportunityId = searchParams.get('opportunityId') ?? '';
  const customerId = searchParams.get('customerId') ?? '';

  if (opportunityId) return <RfqList scope={{ opportunityId }} />;
  if (customerId) return <RfqList scope={{ customerId }} />;

  return (
    <p role="alert" style={errorStyle}>
      No opportunity or customer selected — open one from{' '}
      <button
        type="button"
        onClick={() => router.push('/opportunities')}
        style={{ textDecoration: 'underline', cursor: 'pointer' }}
      >
        RFQ / market
      </button>
      .
    </p>
  );
}

export default function RfqsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>RFQs</h1>
      <Suspense fallback={null}>
        <RfqsFlow />
      </Suspense>
    </main>
  );
}
