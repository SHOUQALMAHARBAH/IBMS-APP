'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  createRfq,
  listSelectableInsurers,
  type SelectableInsurer,
} from '../../../../lib/rfq/rfq-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../../components/lead/lead.styles';
import { insurerPickerStyle } from '../../../../components/rfq/rfq.styles';

function NewRfqForm({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();

  const [insurers, setInsurers] = useState<SelectableInsurer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [insuranceLine, setInsuranceLine] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState('9');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setInsurers(await listSelectableInsurers());
        setLoadError(null);
      } catch (err) {
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? "You don't hold the rfq.create permission."
            : err instanceof ApiError
              ? err.message
              : 'Could not load the insurer list — try again.',
        );
      }
    })();
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const parsedThreshold = Number.parseInt(threshold, 10);
      const rfq = await createRfq({
        opportunityId,
        insuranceLine: insuranceLine.trim(),
        insurerIds: [...selected],
        followUpThresholdDays: Number.isFinite(parsedThreshold)
          ? parsedThreshold
          : undefined,
      });
      router.push(`/rfqs/${rfq.id}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : 'Could not create the RFQ — try again.',
      );
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" style={errorStyle}>
        {loadError}
      </p>
    );
  }
  if (!insurers) return <p>Loading…</p>;

  const canSubmit =
    insuranceLine.trim().length >= 2 && selected.size > 0 && !submitting;

  return (
    <form onSubmit={(e) => void submit(e)} style={{ marginTop: '1rem' }}>
      <label htmlFor="insuranceLine" style={{ display: 'block', fontWeight: 600 }}>
        Insurance line
      </label>
      <div style={cardMetaStyle}>
        One RFQ per line (e.g. &ldquo;Property All Risks&rdquo;, &ldquo;Business
        Interruption&rdquo;). A line already covered by an RFQ on this
        opportunity is rejected.
      </div>
      <input
        id="insuranceLine"
        value={insuranceLine}
        onChange={(e) => setInsuranceLine(e.target.value)}
        placeholder="Property All Risks"
        style={{ minWidth: '20rem', marginTop: '0.35rem' }}
      />

      <fieldset style={{ border: 'none', padding: 0, marginTop: '1.5rem' }}>
        <legend style={{ fontWeight: 600 }}>Insurer shortlist</legend>
        <div style={cardMetaStyle}>Select at least one insurer.</div>
        <div style={insurerPickerStyle}>
          {insurers.length === 0 ? (
            <span style={{ opacity: 0.6 }}>No insurers on file.</span>
          ) : (
            insurers.map((insurer) => (
              <label
                key={insurer.id}
                style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(insurer.id)}
                  onChange={() => toggle(insurer.id)}
                />
                <span>
                  {insurer.name}
                  {insurer.financialStrengthRating
                    ? ` · ${insurer.financialStrengthRating}`
                    : ''}
                </span>
              </label>
            ))
          )}
        </div>
      </fieldset>

      <label
        htmlFor="threshold"
        style={{ display: 'block', fontWeight: 600, marginTop: '1.5rem' }}
      >
        Follow-up threshold (business days)
      </label>
      <div style={cardMetaStyle}>
        The nightly sweep raises a follow-up alert on any insurer that has not
        responded within this many Jordan business days.
      </div>
      <input
        id="threshold"
        type="number"
        min={1}
        max={90}
        value={threshold}
        onChange={(e) => setThreshold(e.target.value)}
        style={{ width: '6rem', marginTop: '0.35rem' }}
      />

      <div style={{ marginTop: '1.5rem' }}>
        <button type="submit" disabled={!canSubmit} style={buttonStyle}>
          {submitting ? 'Creating…' : 'Create RFQ'}
        </button>
      </div>

      {submitError ? (
        <p role="alert" style={errorStyle}>
          {submitError}
        </p>
      ) : null}
    </form>
  );
}

function NewRfqFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const opportunityId = searchParams.get('opportunityId') ?? '';

  if (!opportunityId) {
    return (
      <p role="alert" style={errorStyle}>
        No opportunity selected — open an opportunity from{' '}
        <button
          type="button"
          onClick={() => router.push('/opportunities')}
          style={{ textDecoration: 'underline', cursor: 'pointer' }}
        >
          RFQ / market
        </button>{' '}
        and create the RFQ from there.
      </p>
    );
  }

  return <NewRfqForm opportunityId={opportunityId} />;
}

export default function NewRfqPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>New RFQ</h1>
      <p style={{ opacity: 0.8 }}>
        Process 11 — create one RFQ for one insurance line and send it to a
        shortlist of insurers. Each insurer starts at SENT.
      </p>
      <Suspense fallback={null}>
        <NewRfqFlow />
      </Suspense>
    </main>
  );
}
