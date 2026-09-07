'use client';

import { type CSSProperties, type FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  computeInsurerPerformance,
  listInsurerPerformance,
  type InsurerPerformanceScore,
} from '../../../lib/management-reporting/insurer-performance-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const statRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', margin: '1rem 0' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '0.6rem 0.9rem',
        minWidth: '9rem',
      }}
    >
      <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

export default function InsurerPerformancePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [insurerId, setInsurerId] = useState('');
  const [history, setHistory] = useState<InsurerPerformanceScore[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLookedUp, setHasLookedUp] = useState(false);

  const [computePeriodStart, setComputePeriodStart] = useState('');
  const [computePeriodEnd, setComputePeriodEnd] = useState('');
  const [computePeriodLabel, setComputePeriodLabel] = useState('');
  const [computeError, setComputeError] = useState<string | null>(null);
  const [computeMessage, setComputeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  async function onLookup(e: FormEvent) {
    e.preventDefault();
    try {
      setHistory(await listInsurerPerformance({ insurerId }));
      setLoadError(null);
    } catch (err) {
      setHistory(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the insurer-performance.view permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load insurer performance — try again.',
      );
    } finally {
      setHasLookedUp(true);
    }
  }

  async function onCompute(e: FormEvent) {
    e.preventDefault();
    setComputeError(null);
    setComputeMessage(null);
    try {
      const useDefaultPeriod = !computePeriodLabel && !computePeriodStart && !computePeriodEnd;
      await computeInsurerPerformance(
        useDefaultPeriod
          ? { insurerId }
          : {
              insurerId,
              periodLabel: computePeriodLabel,
              periodStart: computePeriodStart,
              periodEnd: computePeriodEnd,
            },
      );
      setComputeMessage('Score computed.');
      setHistory(await listInsurerPerformance({ insurerId }));
    } catch (err) {
      setComputeError(
        err instanceof ApiError ? err.message : 'Could not compute the score.',
      );
    }
  }

  if (isLoading || !user) return null;

  const latest = history && history.length > 0 ? history[0] : null;

  return (
    <main style={pageStyle}>
      <h1>Insurer Performance</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Quote-response speed, claims service, price competitiveness, and
        service quality, scored monthly per insurer.
      </p>

      <form onSubmit={onLookup} style={formStyle}>
        <h2>Look up an insurer</h2>
        <label style={labelStyle}>
          Insurer ID
          <input
            value={insurerId}
            onChange={(e) => setInsurerId(e.target.value)}
            required
          />
        </label>
        <button type="submit">View performance</button>
      </form>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {latest ? (
        <>
          <div style={statRow}>
            <Stat label="Quote response" value={latest.quoteResponseScore} />
            <Stat label="Claims service" value={latest.claimsServiceScore} />
            <Stat label="Price" value={latest.priceScore} />
            <Stat label="Service quality" value={latest.serviceQualityScore} />
          </div>
          <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>
            Most recent period: {latest.periodLabel} (computed{' '}
            {latest.computedAt.replace('T', ' ').slice(0, 16)}).
          </p>

          <h2>History</h2>
          <table style={{ borderCollapse: 'collapse', minWidth: '30rem' }}>
            <thead>
              <tr>
                <th style={head}>Period</th>
                <th style={head}>Quote response</th>
                <th style={head}>Claims service</th>
                <th style={head}>Price</th>
                <th style={head}>Service quality</th>
              </tr>
            </thead>
            <tbody>
              {history!.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>{row.periodLabel}</td>
                  <td style={cell}>{row.quoteResponseScore}</td>
                  <td style={cell}>{row.claimsServiceScore}</td>
                  <td style={cell}>{row.priceScore}</td>
                  <td style={cell}>{row.serviceQualityScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : hasLookedUp && !loadError ? (
        <p style={{ opacity: 0.6 }}>No score has been computed yet for this insurer.</p>
      ) : null}

      <form onSubmit={onCompute} style={formStyle}>
        <h2>Compute now</h2>
        <p style={{ opacity: 0.7, fontSize: '0.85rem', margin: 0 }}>
          Uses the Insurer ID above. Leave the period fields blank to score
          the UTC calendar month that just ended (what the monthly job
          itself does).
        </p>
        <label style={labelStyle}>
          Period label (optional)
          <input
            value={computePeriodLabel}
            onChange={(e) => setComputePeriodLabel(e.target.value)}
          />
        </label>
        <label style={labelStyle}>
          Period start (optional)
          <input
            type="date"
            value={computePeriodStart}
            onChange={(e) => setComputePeriodStart(e.target.value)}
          />
        </label>
        <label style={labelStyle}>
          Period end (optional)
          <input
            type="date"
            value={computePeriodEnd}
            onChange={(e) => setComputePeriodEnd(e.target.value)}
          />
        </label>
        <button type="submit" disabled={!insurerId}>
          Compute
        </button>
        {computeError ? (
          <p role="alert" style={errorStyle}>
            {computeError}
          </p>
        ) : null}
        {computeMessage ? <p>{computeMessage}</p> : null}
      </form>
    </main>
  );
}
