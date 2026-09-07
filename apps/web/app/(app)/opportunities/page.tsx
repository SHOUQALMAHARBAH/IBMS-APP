'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  listOpportunities,
  type Opportunity,
} from '../../../lib/opportunity/opportunity-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../components/lead/lead.styles';
import { rfqBadgeStyle, rfqCardStyle } from '../../../components/rfq/rfq.styles';

function OpportunitiesForCustomer({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOpportunities(await listOpportunities(customerId));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the opportunity.read permission, so there's nothing to show here."
          : err instanceof ApiError && err.status === 404
            ? 'This customer could not be found — it may not exist, or you may not have access to it.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load opportunities — try again.',
      );
    }
  }, [customerId]);

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
  if (!opportunities) return <p>Loading…</p>;

  if (opportunities.length === 0) {
    return (
      <p style={{ opacity: 0.6, marginTop: '1rem' }}>
        No opportunities for this customer yet. Open a finalized insurance
        program and choose &ldquo;Take to market&rdquo; to create one.
      </p>
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
            <strong>Opportunity {opportunity.id.slice(0, 8)}</strong>
            <span style={rfqBadgeStyle}>{opportunity.status}</span>
          </div>
          <div style={cardMetaStyle}>
            {opportunity.isRenewal ? 'Renewal' : 'New business'} · created{' '}
            {new Date(opportunity.createdAt).toLocaleDateString()}
          </div>
        </button>
      ))}
    </div>
  );
}

function OpportunitiesFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';

  if (!customerId) {
    return (
      <p role="alert" style={errorStyle}>
        No customer selected — open a customer from{' '}
        <button
          type="button"
          onClick={() => router.push('/customers')}
          style={{ textDecoration: 'underline', cursor: 'pointer' }}
        >
          Customers
        </button>{' '}
        and reach its opportunities from a finalized insurance program.
      </p>
    );
  }

  return <OpportunitiesForCustomer customerId={customerId} />;
}

export default function OpportunitiesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>RFQ / market</h1>
      <p style={{ opacity: 0.8 }}>
        Process 11 — a finalized insurance program is taken to market as an
        Opportunity. Open one to raise an RFQ per insurance line and send it to
        a shortlist of insurers.
      </p>
      <Suspense fallback={null}>
        <OpportunitiesFlow />
      </Suspense>
    </main>
  );
}
