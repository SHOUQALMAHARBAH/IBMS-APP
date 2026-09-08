'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getClaimsDashboard,
  type ClaimsDashboardSummary,
  type LossRatioBreakdownRow,
} from '../../../../lib/management-reporting/claims-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

function LossRatioTable({ title, rows }: { title: string; rows: LossRatioBreakdownRow[] }) {
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
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>Claims (JOD)</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>Premium (JOD)</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>Ratio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: '0.25rem 0.5rem' }}>
                  <bdi>{r.label}</bdi>
                </td>
                <td style={{ padding: '0.25rem 0.5rem' }}>{r.periodClaims}</td>
                <td style={{ padding: '0.25rem 0.5rem' }}>{r.periodPremium}</td>
                <td style={{ padding: '0.25rem 0.5rem' }}>
                  {r.ratio}
                  {r.ratioCapped ? ' (capped)' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function ClaimsDashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<ClaimsDashboardSummary | null>(null);
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
        await getClaimsDashboard({
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
          ? "You don't hold the dashboard.claims.view permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the Claims Dashboard — try again.',
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
      <h1>Claims Dashboard</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Every metric here is a live snapshot as of a reference date (default
        today) — open vs. closed claims, outstanding claims value, claims
        ageing, and loss ratio by client/line/insurer.
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
            dir="auto"
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
            <h2>Open vs. closed claims</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.openClaimsCount}</div>
                <div>Open</div>
              </div>
              <div>
                <div style={statStyle}>{summary.closedClaimsCount}</div>
                <div>Closed</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Outstanding claims value</h2>
            <div style={statStyle}>{summary.outstandingClaimsValueJod} JOD</div>
          </section>

          <section style={sectionStyle}>
            <h2>Claims ageing (open claims)</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.ageing.d0_30.count}</div>
                <div>0-30 days ({summary.ageing.d0_30.valueJod} JOD)</div>
              </div>
              <div>
                <div style={statStyle}>{summary.ageing.d31_60.count}</div>
                <div>31-60 days ({summary.ageing.d31_60.valueJod} JOD)</div>
              </div>
              <div>
                <div style={statStyle}>{summary.ageing.d61_90.count}</div>
                <div>61-90 days ({summary.ageing.d61_90.valueJod} JOD)</div>
              </div>
              <div>
                <div style={statStyle}>{summary.ageing.d90_plus.count}</div>
                <div>90+ days ({summary.ageing.d90_plus.valueJod} JOD)</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Loss ratio</h2>
            <LossRatioTable title="By client" rows={summary.lossRatioByClient} />
            <LossRatioTable title="By line" rows={summary.lossRatioByLine} />
            <LossRatioTable title="By insurer" rows={summary.lossRatioByInsurer} />
          </section>
        </>
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}
