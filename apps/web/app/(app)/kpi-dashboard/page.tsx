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
import { formatMoney } from '../../../lib/i18n/format';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { LEAD_STATUS_LABEL_KEY } from '../../../lib/lead/lead-status';
import { OPPORTUNITY_STATUS_LABEL_KEY } from '../../../lib/opportunity/opportunity-status';
import { INVOICE_STATUS_LABEL_KEY } from '../../../lib/finance/invoice-status';
import type { TranslationKey } from '../../../lib/i18n/translations';

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

/**
 * 🔴 OWNER DECISION 153 §M1 — THE STATUS IS A STORED VALUE, AND IT WAS RENDERED RAW.
 *
 * This table printed `{status}` for all SEVEN breakdowns on this screen, so a reader in Arabic
 * met `CONVERTED_TO_PROSPECT`, `RECOMMENDATION_DRAFTED`, `EXCEPTION_RAISED` and four more
 * vocabularies' worth of machine text under Arabic headings.
 *
 * ⟶ Each call site passes the vocabulary ITS keys belong to — seven different ones, and ⛔ not
 *   one shared map, because `leadsByStatus` and `claimsByStatus` are different closed sets that
 *   happen to be rendered by one component.
 *
 * ⛔ A key the map does not carry renders AS STORED (owner decision 49), never blank: an empty
 * cell is decision 148's defect, where a missing label printed nothing and nobody was told.
 */
function StatusTable({
  counts,
  vocabulary,
}: {
  counts: Record<string, number>;
  vocabulary: Record<string, TranslationKey>;
}) {
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
            <Td>{status in vocabulary ? t(vocabulary[status]) : status}</Td>
            <Td>{count}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
          </Card>
  );
}

export default function KpiDashboardPage() {
  // 🔴 `language` ADDED — three `Stat` tiles printed the API's raw decimal string. ⚠️ The
  // OTHER tiles on this screen are COUNTS (customers, leads, open claims) and are correct
  // unformatted: `formatMoney` would stamp «JOD» on a number of people.
  const { t, language } = useLanguage();
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
                <StatusTable
                  counts={summary.sales.leadsByStatus}
                  vocabulary={LEAD_STATUS_LABEL_KEY}
                />
              </div>
              <div>
                <h3>{t('kpiProspects')}</h3>
                <StatusTable
                  counts={summary.sales.prospectsByStatus}
                  vocabulary={ENUM_LABEL.ProspectStatus}
                />
              </div>
              <div>
                <h3>{t('kpiOpportunities')}</h3>
                <StatusTable
                  counts={summary.sales.opportunitiesByStatus}
                  vocabulary={OPPORTUNITY_STATUS_LABEL_KEY}
                />
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('kpiPolicy')}</h2>
            <div style={statRow}>
              <Stat
                label={t('kpiTotalIssuedPremium')}
                value={formatMoney(summary.policy.totalIssuedPremiumJod, language)}
              />
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <StatusTable
                counts={summary.policy.policiesByStatus}
                vocabulary={ENUM_LABEL.PolicyStatus}
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('kpiClaims')}</h2>
            <StatusTable
              counts={summary.claims.claimsByStatus}
              vocabulary={ENUM_LABEL.ClaimStatus}
            />
          </section>

          <section style={sectionStyle}>
            <h2>{t('kpiFinance')}</h2>
            <div style={statRow}>
              <Stat
                label={t('kpiOutstandingInvoiced')}
                value={formatMoney(
                  summary.finance.outstandingInvoicedJod,
                  language,
                )}
              />
              <Stat
                label={t('kpiCommissionThisMonth')}
                value={formatMoney(
                  summary.finance.commissionThisMonthJod,
                  language,
                )}
              />
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <StatusTable
                counts={summary.finance.invoicesByStatus}
                vocabulary={INVOICE_STATUS_LABEL_KEY}
              />
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
                vocabulary={ENUM_LABEL.ComplaintStatus}
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
