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
import { useLanguage } from '../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.75rem' };

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
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
  const { t } = useLanguage();
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return <p style={{ color: 'var(--ink-secondary)' }}>{t('kpiNone')}</p>;
  }
  return (
    <table style={{ borderCollapse: 'collapse', minWidth: '20rem' }}>
      <thead>
        <tr>
          <th style={head}>{t('kpiColStatus')}</th>
          <th style={head}>{t('kpiColCount')}</th>
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
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<KpiDashboardSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
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
            ? t('kpiNoPermission')
            : err instanceof ApiError
              ? err.message
              : t('kpiLoadError'),
        );
      }
    })();
  }, [user, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('kpiHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('kpiIntro')}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {summary ? (
        <>
          <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
            Generated {summary.generatedAt.replace('T', ' ').slice(0, 16)}.
          </p>

          <section style={sectionStyle}>
            <h2>{t('kpiSales')}</h2>
            <div style={statRow}>
              <Stat label={t('kpiCustomers')} value={summary.sales.totalCustomers} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', marginTop: '0.75rem' }}>
              <div>
                <h3>{t('kpiLeads')}</h3>
                <StatusTable counts={summary.sales.leadsByStatus} />
              </div>
              <div>
                <h3>{t('kpiProspects')}</h3>
                <StatusTable counts={summary.sales.prospectsByStatus} />
              </div>
              <div>
                <h3>{t('kpiOpportunities')}</h3>
                <StatusTable counts={summary.sales.opportunitiesByStatus} />
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('kpiPolicy')}</h2>
            <div style={statRow}>
              <Stat
                label={t('kpiTotalIssuedPremium')}
                value={summary.policy.totalIssuedPremiumJod}
              />
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <StatusTable counts={summary.policy.policiesByStatus} />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('kpiClaims')}</h2>
            <StatusTable counts={summary.claims.claimsByStatus} />
          </section>

          <section style={sectionStyle}>
            <h2>{t('kpiFinance')}</h2>
            <div style={statRow}>
              <Stat
                label={t('kpiOutstandingInvoiced')}
                value={summary.finance.outstandingInvoicedJod}
              />
              <Stat
                label={t('kpiCommissionThisMonth')}
                value={summary.finance.commissionThisMonthJod}
              />
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <StatusTable counts={summary.finance.invoicesByStatus} />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('kpiCustomerService')}</h2>
            <div style={statRow}>
              <Stat
                label={t('kpiOpenServiceRequests')}
                value={summary.customerService.openServiceRequests}
              />
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <StatusTable counts={summary.customerService.complaintsByStatus} />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('kpiComplianceRisk')}</h2>
            <div style={statRow}>
              <Stat
                label={t('kpiOpenRiskItems')}
                value={summary.complianceRisk.openRiskRegisterItems}
              />
              <Stat
                label={t('kpiOpenIncidents')}
                value={summary.complianceRisk.openIncidents}
              />
              <Stat
                label={t('kpiOpenAuditFindings')}
                value={summary.complianceRisk.openInternalAuditFindings}
              />
            </div>
          </section>
        </>
      ) : loadError ? null : (
        <p>{t('dashLoading')}</p>
      )}
    </main>
  );
}
