'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getKpiDashboardSummary,
  type KpiDashboardSummary,
} from '../../../lib/management-reporting/kpi-dashboard-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.75rem' };

function Stat({ label, value }: { label: string; value: string | number }) {
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

function StatusTable({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return <p style={{ opacity: 0.6 }}>No records yet.</p>;
  }
  return (
    <table style={{ borderCollapse: 'collapse', minWidth: '20rem' }}>
      <thead>
        <tr>
          <th style={head}>Status</th>
          <th style={head}>Count</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([status, count]) => (
          <tr key={status}>
            <td style={cell}>{status}</td>
            <td style={cell}>{count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function KpiDashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<KpiDashboardSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        setSummary(await getKpiDashboardSummary());
        setLoadError(null);
      } catch (err) {
        setSummary(null);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? "You don't hold the kpi-dashboard.view permission."
            : err instanceof ApiError
              ? err.message
              : 'Could not load the KPI dashboard — try again.',
        );
      }
    })();
  }, [user]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>General KPI Dashboard</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        A live, book-wide snapshot across every module — Sales, Policy,
        Claims, Finance, Customer Service, and Compliance &amp; Risk.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {summary ? (
        <>
          <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>
            Generated {summary.generatedAt.replace('T', ' ').slice(0, 16)}.
          </p>

          <section style={sectionStyle}>
            <h2>Sales</h2>
            <div style={statRow}>
              <Stat label="Customers" value={summary.sales.totalCustomers} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', marginTop: '0.75rem' }}>
              <div>
                <h3>Leads</h3>
                <StatusTable counts={summary.sales.leadsByStatus} />
              </div>
              <div>
                <h3>Prospects</h3>
                <StatusTable counts={summary.sales.prospectsByStatus} />
              </div>
              <div>
                <h3>Opportunities</h3>
                <StatusTable counts={summary.sales.opportunitiesByStatus} />
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Policy</h2>
            <div style={statRow}>
              <Stat
                label="Total issued premium (JOD)"
                value={summary.policy.totalIssuedPremiumJod}
              />
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <StatusTable counts={summary.policy.policiesByStatus} />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Claims</h2>
            <StatusTable counts={summary.claims.claimsByStatus} />
          </section>

          <section style={sectionStyle}>
            <h2>Finance</h2>
            <div style={statRow}>
              <Stat
                label="Outstanding invoiced (JOD)"
                value={summary.finance.outstandingInvoicedJod}
              />
              <Stat
                label="Commission this month (JOD)"
                value={summary.finance.commissionThisMonthJod}
              />
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <StatusTable counts={summary.finance.invoicesByStatus} />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Customer Service</h2>
            <div style={statRow}>
              <Stat
                label="Open service requests"
                value={summary.customerService.openServiceRequests}
              />
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <StatusTable counts={summary.customerService.complaintsByStatus} />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Compliance &amp; Risk</h2>
            <div style={statRow}>
              <Stat
                label="Open risk register items"
                value={summary.complianceRisk.openRiskRegisterItems}
              />
              <Stat
                label="Open incidents"
                value={summary.complianceRisk.openIncidents}
              />
              <Stat
                label="Open internal audit findings"
                value={summary.complianceRisk.openInternalAuditFindings}
              />
            </div>
          </section>
        </>
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}
