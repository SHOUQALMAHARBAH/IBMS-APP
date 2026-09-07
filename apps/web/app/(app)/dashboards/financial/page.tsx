'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getFinancialDashboard,
  type FinancialDashboardSummary,
  type ProfitabilityRow,
} from '../../../../lib/management-reporting/financial-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

function ProfitabilityTable({ title, rows }: { title: string; rows: ProfitabilityRow[] }) {
  return (
    <section style={sectionStyle}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p>No data.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>Group</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>Premium (JOD)</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>Claims (JOD)</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>Commission (JOD)</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>Net position (JOD)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: '0.25rem 0.5rem' }}>{r.label}</td>
                <td style={{ padding: '0.25rem 0.5rem' }}>{r.premiumWritten}</td>
                <td style={{ padding: '0.25rem 0.5rem' }}>{r.claimsPaid}</td>
                <td style={{ padding: '0.25rem 0.5rem' }}>{r.commissionEarned}</td>
                <td style={{ padding: '0.25rem 0.5rem' }}>{r.netPosition}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function FinancialDashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<FinancialDashboardSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [branchId, setBranchId] = useState('');
  const [insuranceLine, setInsuranceLine] = useState('');
  const [insurerId, setInsurerId] = useState('');
  const [asOf, setAsOf] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setSummary(
        await getFinancialDashboard({
          branchId: branchId.trim() || undefined,
          insuranceLine: insuranceLine.trim() || undefined,
          insurerId: insurerId.trim() || undefined,
          asOf: asOf.trim() || undefined,
        }),
      );
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the dashboard.financial.view permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the Financial Dashboard — try again.',
      );
    }
  }, [branchId, insuranceLine, insurerId, asOf]);

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
      <h1>Financial Dashboard</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Receivables and payables are a point-in-time snapshot as of a
        reference date (default today). Commission and profitability are
        current-state and ignore the reference date.
      </p>

      <form
        onSubmit={applyFilters}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          Branch ID
          <input aria-label="Branch ID filter" value={branchId} onChange={(e) => setBranchId(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          Insurance line
          <input
            aria-label="Insurance line filter"
            value={insuranceLine}
            onChange={(e) => setInsuranceLine(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          Insurer ID
          <input aria-label="Insurer ID filter" value={insurerId} onChange={(e) => setInsurerId(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          As of
          <input aria-label="As of date" placeholder="YYYY-MM-DD" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <button type="submit">Apply filters</button>
      </form>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {summary ? (
        <>
          <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>As of {summary.asOf.slice(0, 10)}.</p>

          <section style={sectionStyle}>
            <h2>Receivables (ageing)</h2>
            <div style={statStyle}>{summary.receivables.totals.outstandingTotal} JOD</div>
            <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
              <div>Current: {summary.receivables.totals.current}</div>
              <div>1-30d: {summary.receivables.totals.d1_30}</div>
              <div>31-60d: {summary.receivables.totals.d31_60}</div>
              <div>61-90d: {summary.receivables.totals.d61_90}</div>
              <div>90+d: {summary.receivables.totals.d90_plus}</div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Payables to insurers</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.payables.totals.outstandingAmount} JOD</div>
                <div>Outstanding ({summary.payables.totals.outstandingCount})</div>
              </div>
              <div>
                <div style={statStyle}>{summary.payables.totals.remittedAmount} JOD</div>
                <div>Remitted ({summary.payables.totals.remittedCount})</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Commission income</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.commission.earned} JOD</div>
                <div>Earned</div>
              </div>
              <div>
                <div style={statStyle}>{summary.commission.outstanding} JOD</div>
                <div>Outstanding</div>
              </div>
              <div>
                <div style={statStyle}>{summary.commission.paid} JOD</div>
                <div>Paid</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Profitability</h2>
            <ProfitabilityTable title="By line" rows={summary.profitability.byLine} />
            <ProfitabilityTable title="By client segment" rows={summary.profitability.bySegment} />
          </section>
        </>
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}
