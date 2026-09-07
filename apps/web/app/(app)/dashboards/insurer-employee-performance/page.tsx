'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  listInsurerPerformance,
  type InsurerPerformanceScore,
} from '../../../../lib/management-reporting/insurer-performance-api';
import {
  listEmployeePerformance,
  type EmployeePerformanceRecord,
} from '../../../../lib/management-reporting/employee-performance-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const cell: CSSProperties = { padding: '0.35rem 0.75rem', borderBottom: '1px solid #e5e7eb', textAlign: 'left' };
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };

function previousUtcMonthLabel(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function displayOrDash(value: string | number | null): string {
  return value === null ? '—' : String(value);
}

export default function InsurerEmployeePerformanceDashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [periodLabel, setPeriodLabel] = useState(previousUtcMonthLabel());
  const [branchId, setBranchId] = useState('');
  const [insurerId, setInsurerId] = useState('');

  const [insurerScores, setInsurerScores] = useState<InsurerPerformanceScore[] | null>(null);
  const [employeeRecords, setEmployeeRecords] = useState<EmployeePerformanceRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      const [scores, records] = await Promise.all([
        listInsurerPerformance({
          periodLabel: periodLabel.trim() || undefined,
          insurerId: insurerId.trim() || undefined,
        }),
        listEmployeePerformance({
          periodLabel: periodLabel.trim() || undefined,
          branchId: branchId.trim() || undefined,
        }),
      ]);
      setInsurerScores(scores);
      setEmployeeRecords(records);
      setLoadError(null);
    } catch (err) {
      setInsurerScores(null);
      setEmployeeRecords(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the insurer-performance.view / employee-performance.view permissions."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the Insurer & Employee Performance Dashboard — try again.',
      );
    }
  }, [periodLabel, branchId, insurerId]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
    // Filters apply on explicit "Apply filters" submit only — see below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function applyFilters(ev: React.FormEvent) {
    ev.preventDefault();
    void load();
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Insurer &amp; Employee Performance Dashboard</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Insurer performance score across 4 axes (backlog #60) and employee KPI
        achievement (backlog #61) for one period. Insurer ID scopes the
        insurer table to a single insurer&apos;s already-computed score;
        branch scoping applies only to employee performance — an
        insurer&apos;s score is a book-wide figure with no branch dimension.
        Neither table has an insurance-line dimension of its own.
      </p>

      <form
        onSubmit={applyFilters}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          Period label
          <input
            aria-label="Period label"
            placeholder="e.g. 2026-08"
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          Insurer ID (insurer table only)
          <input aria-label="Insurer ID filter" value={insurerId} onChange={(e) => setInsurerId(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          Branch ID (employees only)
          <input aria-label="Branch ID filter" value={branchId} onChange={(e) => setBranchId(e.target.value)} />
        </label>
        <button type="submit">Apply filters</button>
      </form>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      <section style={sectionStyle}>
        <h2>Insurer performance (4 axes)</h2>
        {insurerScores === null ? null : insurerScores.length === 0 ? (
          <p>No insurer scores computed for this period yet.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
            <thead>
              <tr>
                <th style={head}>Insurer ID</th>
                <th style={head}>Quote response</th>
                <th style={head}>Claims service</th>
                <th style={head}>Price</th>
                <th style={head}>Service quality</th>
              </tr>
            </thead>
            <tbody>
              {insurerScores.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>{row.insurerId}</td>
                  <td style={cell}>{row.quoteResponseScore}</td>
                  <td style={cell}>{row.claimsServiceScore}</td>
                  <td style={cell}>{row.priceScore}</td>
                  <td style={cell}>{row.serviceQualityScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={sectionStyle}>
        <h2>Employee KPI achievement</h2>
        {employeeRecords === null ? null : employeeRecords.length === 0 ? (
          <p>No employee performance records computed for this period yet.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
            <thead>
              <tr>
                <th style={head}>Employee ID</th>
                <th style={head}>New clients</th>
                <th style={head}>Premium written</th>
                <th style={head}>Commission earned</th>
                <th style={head}>Renewal rate</th>
                <th style={head}>Cross-sell rate</th>
              </tr>
            </thead>
            <tbody>
              {employeeRecords.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>{row.employeeId}</td>
                  <td style={cell}>{displayOrDash(row.newClients)}</td>
                  <td style={cell}>{displayOrDash(row.premiumWrittenJod)}</td>
                  <td style={cell}>{displayOrDash(row.commissionEarnedJod)}</td>
                  <td style={cell}>{row.renewalRatePercent === null ? '—' : `${row.renewalRatePercent}%`}</td>
                  <td style={cell}>{row.crossSellRatePercent === null ? '—' : `${row.crossSellRatePercent}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
