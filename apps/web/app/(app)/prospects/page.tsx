'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { listProspects, type Prospect } from '../../../lib/prospect/prospect-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { cardMetaStyle, cardStyle, pageStyle } from '../../../components/lead/lead.styles';
import { listGridStyle } from '../../../components/prospect/prospect.styles';

export default function ProspectsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [prospects, setProspects] = useState<Prospect[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProspects = useCallback(async () => {
    try {
      const result = await listProspects();
      setProspects(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the prospect.read permission, so there's nothing to show here."
          : err instanceof ApiError
            ? err.message
            : 'Could not load prospects — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadProspects();
    })();
  }, [user, loadProspects]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Prospects</h1>
      <p style={{ opacity: 0.8 }}>
        Process 2 — qualified leads that have been converted into prospects. Convert a lead from
        the pipeline board to add one here.
      </p>

      {prospects === null && !loadError ? <p>Loading…</p> : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {prospects !== null && !loadError ? (
        prospects.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No prospects yet.</p>
        ) : (
          <div style={listGridStyle}>
            {prospects.map((prospect) => (
              <button
                key={prospect.id}
                type="button"
                style={{ ...cardStyle, textAlign: 'left', width: '100%', cursor: 'pointer' }}
                aria-label={`View profile — ${prospect.companyName}`}
                onClick={() => router.push(`/prospects/${prospect.id}`)}
              >
                <strong>{prospect.companyName}</strong>
                {prospect.sector ? <div style={cardMetaStyle}>{prospect.sector}</div> : null}
                {prospect.location ? <div style={cardMetaStyle}>{prospect.location}</div> : null}
                <div style={cardMetaStyle}>Status: {prospect.status}</div>
              </button>
            ))}
          </div>
        )
      ) : null}
    </main>
  );
}
