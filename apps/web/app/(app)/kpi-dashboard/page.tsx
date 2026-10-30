'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import { ReportProvenance } from '../../../components/ui/ReportProvenance';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getKpiDashboardSummary,
  type KpiDashboardSummary,
} from '../../../lib/management-reporting/kpi-dashboard-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-3)',
};

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
    return <EmptyState title={t('kpiNone')} />;
  }
  return (
    <Card padded={false}>
            <Table>
      <thead>
        <tr>
          <Th>{t('kpiColStatus')}</Th>
          <Th>{t('kpiColCount')}</Th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([status, count]) => (
          <Tr key={status}>
            <Td>{status}</Td>
            <Td>{count}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
          </Card>
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
            ? permissionRefusal(t, 'kpiRefusalAct', 'kpi-dashboard.view')
            : err instanceof ApiError
              ? err.message
              : t('kpiLoadError'),
        );
      }
    })();
  }, [user, t]);

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('kpiHeading')}
        description={t('kpiIntro')}
      />

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {summary ? (
        <>
          <ReportProvenance kind="generatedAt" at={summary.generatedAt} />

          <section style={sectionStyle}>
            <h2>{t('kpiSales')}</h2>
            <div style={statRow}>
              <Stat
                label={t('kpiCustomers')}
                value={summary.sales.totalCustomers}
              />
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '2rem',
                marginTop: '0.75rem',
              }}
            >
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
              <StatusTable
                counts={summary.customerService.complaintsByStatus}
              />
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
        <SkeletonList rows={4} label={t('dashLoading')} />
      )}
    </main>
  );
}
