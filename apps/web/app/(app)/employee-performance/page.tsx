'use client';

import { type CSSProperties, type FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  computeEmployeePerformance,
  listEmployeePerformance,
  type EmployeePerformanceRecord,
} from '../../../lib/management-reporting/employee-performance-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
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

function displayOrDash(value: string | number | null): string {
  return value === null ? '—' : String(value);
}

export default function EmployeePerformancePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [employeeId, setEmployeeId] = useState('');
  const [history, setHistory] = useState<EmployeePerformanceRecord[] | null>(null);
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
      setHistory(await listEmployeePerformance({ employeeId }));
      setLoadError(null);
    } catch (err) {
      setHistory(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the employee-performance.view permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load employee performance — try again.',
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
      await computeEmployeePerformance(
        useDefaultPeriod
          ? { employeeId }
          : {
              employeeId,
              periodLabel: computePeriodLabel,
              periodStart: computePeriodStart,
              periodEnd: computePeriodEnd,
            },
      );
      setComputeMessage('Record computed.');
      setHistory(await listEmployeePerformance({ employeeId }));
    } catch (err) {
      setComputeError(
        err instanceof ApiError ? err.message : 'Could not compute the record.',
      );
    }
  }

  if (isLoading || !user) return null;

  const latest = history && history.length > 0 ? history[0] : null;

  return (
    <main style={pageStyle}>
      <h1>Employee Performance</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        New clients, premium written, commission earned, renewal rate, and
        cross-sell rate, scored monthly per employee.
      </p>

      <form onSubmit={onLookup} style={formStyle}>
        <h2>Look up an employee</h2>
        <label style={labelStyle}>
          Employee ID
          <input
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
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
            <Stat label="New clients" value={displayOrDash(latest.newClients)} />
            <Stat
              label="Premium written (JOD)"
              value={displayOrDash(latest.premiumWrittenJod)}
            />
            <Stat
              label="Commission earned (JOD)"
              value={displayOrDash(latest.commissionEarnedJod)}
            />
            <Stat
              label="Renewal rate"
              value={
                latest.renewalRatePercent === null
                  ? '—'
                  : `${latest.renewalRatePercent}%`
              }
            />
            <Stat
              label="Cross-sell rate"
              value={
                latest.crossSellRatePercent === null
                  ? '—'
                  : `${latest.crossSellRatePercent}%`
              }
            />
          </div>
          <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>
            Most recent period: {latest.periodLabel}. A dash means no outcomes
            existed to rate that period, not a computed 0%.
          </p>

          <h2>History</h2>
          <table style={{ borderCollapse: 'collapse', minWidth: '30rem' }}>
            <thead>
              <tr>
                <th style={head}>Period</th>
                <th style={head}>New clients</th>
                <th style={head}>Premium written</th>
                <th style={head}>Commission earned</th>
                <th style={head}>Renewal rate</th>
                <th style={head}>Cross-sell rate</th>
              </tr>
            </thead>
            <tbody>
              {history!.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>{row.periodLabel}</td>
                  <td style={cell}>{displayOrDash(row.newClients)}</td>
                  <td style={cell}>{displayOrDash(row.premiumWrittenJod)}</td>
                  <td style={cell}>{displayOrDash(row.commissionEarnedJod)}</td>
                  <td style={cell}>
                    {row.renewalRatePercent === null
                      ? '—'
                      : `${row.renewalRatePercent}%`}
                  </td>
                  <td style={cell}>
                    {row.crossSellRatePercent === null
                      ? '—'
                      : `${row.crossSellRatePercent}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : hasLookedUp && !loadError ? (
        <p style={{ opacity: 0.6 }}>No record has been computed yet for this employee.</p>
      ) : null}

      <form onSubmit={onCompute} style={formStyle}>
        <h2>Compute now</h2>
        <p style={{ opacity: 0.7, fontSize: '0.85rem', margin: 0 }}>
          Uses the Employee ID above. Leave the period fields blank to score
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
        <button type="submit" disabled={!employeeId}>
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
