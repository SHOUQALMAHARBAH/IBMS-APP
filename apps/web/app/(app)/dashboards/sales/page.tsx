'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getSalesDashboard,
  type SalesDashboardSummary,
} from '../../../../lib/management-reporting/sales-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

export default function SalesDashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<SalesDashboardSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [branchId, setBranchId] = useState('');
  const [insuranceLine, setInsuranceLine] = useState('');
  const [insurerId, setInsurerId] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setSummary(
        await getSalesDashboard({
          branchId: branchId.trim() || undefined,
          insuranceLine: insuranceLine.trim() || undefined,
          insurerId: insurerId.trim() || undefined,
          periodLabel: periodLabel.trim() || undefined,
          periodStart: periodStart.trim() || undefined,
          periodEnd: periodEnd.trim() || undefined,
        }),
      );
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the dashboard.sales.view permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the Sales Dashboard — try again.',
      );
    }
  }, [branchId, insuranceLine, insurerId, periodLabel, periodStart, periodEnd]);

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
      <h1>Sales Dashboard</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        New leads and conversion rate, premium written (new vs. renewal),
        commission income, and cross-sell/up-sell opportunity conversion.
        Defaults to the previous calendar month.
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
          Period label
          <input
            aria-label="Period label"
            placeholder="e.g. 2026-08"
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          Period start
          <input
            aria-label="Period start"
            placeholder="YYYY-MM-DD"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          Period end
          <input
            aria-label="Period end"
            placeholder="YYYY-MM-DD"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
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
          <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>
            Period {summary.periodLabel} ({summary.periodStart.slice(0, 10)} –{' '}
            {summary.periodEnd.slice(0, 10)}).
          </p>

          <section style={sectionStyle}>
            <h2>Leads</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.leads.newLeadsCount}</div>
                <div>New leads</div>
              </div>
              <div>
                <div style={statStyle}>{summary.leads.convertedToProspectCount}</div>
                <div>Converted to Prospect</div>
              </div>
              <div>
                <div style={statStyle}>{summary.leads.conversionRatePercent}%</div>
                <div>Conversion rate</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Premium written</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.premiumWritten.newJod}</div>
                <div>New business (JOD)</div>
              </div>
              <div>
                <div style={statStyle}>{summary.premiumWritten.renewalJod}</div>
                <div>Renewal (JOD)</div>
              </div>
              <div>
                <div style={statStyle}>{summary.premiumWritten.totalJod}</div>
                <div>Total (JOD)</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Commission income</h2>
            <div style={statStyle}>{summary.commissionIncomeJod} JOD</div>
          </section>

          <section style={sectionStyle}>
            <h2>Cross-sell conversion</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.crossSell.totalCount}</div>
                <div>Opportunities</div>
              </div>
              <div>
                <div style={statStyle}>{summary.crossSell.convertedCount}</div>
                <div>Converted</div>
              </div>
              <div>
                <div style={statStyle}>{summary.crossSell.conversionRatePercent}%</div>
                <div>Conversion rate</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Up-sell conversion</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.upSell.totalCount}</div>
                <div>Recommendations</div>
              </div>
              <div>
                <div style={statStyle}>{summary.upSell.convertedCount}</div>
                <div>Converted</div>
              </div>
              <div>
                <div style={statStyle}>{summary.upSell.conversionRatePercent}%</div>
                <div>Conversion rate</div>
              </div>
            </div>
          </section>
        </>
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}
