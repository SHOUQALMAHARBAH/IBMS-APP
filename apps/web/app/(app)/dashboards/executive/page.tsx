'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getExecutiveDashboard,
  type ExecutiveDashboardSummary,
} from '../../../../lib/management-reporting/executive-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  DateEcho,
  ErrorState,
  Hint,
  PageHeader,
  SkeletonList,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../../components/ui/EntitySearch';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };
const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
  gap: '1.25rem',
};

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <div style={statStyle}>{value}</div>
      <div style={{ opacity: 0.75 }}>{label}</div>
    </div>
  );
}

export default function ExecutiveDashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [summary, setSummary] = useState<ExecutiveDashboardSummary | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState('');
  const [insuranceLine, setInsuranceLine] = useState('');
  const [asOf, setAsOf] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setSummary(
        await getExecutiveDashboard({
          branchId: branchId.trim() || undefined,
          insuranceLine: insuranceLine.trim() || undefined,
          asOf: asOf.trim() || undefined,
        }),
      );
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'execRefusalAct', 'dashboard.executive.view')
          : err instanceof ApiError
            ? err.message
            : t('execCouldNotLoadTheExecutive'),
      );
    }
  }, [branchId, insuranceLine, asOf, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
    // Filters apply on explicit submit only — same as the sibling dashboards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, t]);

  function applyFilters(ev: React.FormEvent) {
    ev.preventDefault();
    void load();
  }

  if (isLoading || !user) return null;

  const h = summary?.headlines;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('execExecutiveDashboard')}
        description={t('execTheSalesPolicyClaimsFinancial')}
      />

      <form
        onSubmit={applyFilters}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          alignItems: 'flex-end',
          margin: '0.75rem 0',
        }}
      >
        <EntitySearch
          kind="branch"
          value={branchId}
          onChange={setBranchId}
          label={t('execBranchId')}
        />
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          {t('execInsuranceLine')}
          <input
            aria-label={t('dashInsuranceLineFilterAria')}
            value={insuranceLine}
            onChange={(e) => setInsuranceLine(e.target.value)}
          />
        </label>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          <label htmlFor="exec-as-of">{t('execAsOf')}</label>
          <input
            id="exec-as-of"
            aria-describedby="exec-as-of-hint"
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
          <Hint id="exec-as-of-hint">{t('execAsOfHint')}</Hint>
          <DateEcho value={asOf} />
        </div>
        <button type="submit">{t('execApplyFilters')}</button>
      </form>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {summary && h ? (
        <>
          <p style={{ color: 'var(--ink-secondary)' }}>
            {t('execPeriodAsOf', {
              period: summary.periodLabel,
              asOf: summary.asOf.slice(0, 10),
            })}
          </p>

          <section style={sectionStyle}>
            <h2>{t('execSales')}</h2>
            <div style={gridStyle}>
              <Stat value={h.newLeadsCount} label={t('execNewLeads')} />
              <Stat
                value={
                  h.leadConversionRatePercent === null
                    ? '—'
                    : `${h.leadConversionRatePercent}%`
                }
                label={t('execConversionRate')}
              />
              <Stat
                value={h.commissionIncomeJod}
                label={t('execCommissionIncomeJod')}
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('execPolicy')}</h2>
            <div style={gridStyle}>
              <Stat
                value={h.activePoliciesCount}
                label={t('execActivePolicies')}
              />
              <Stat
                value={h.expiringPoliciesCount}
                label={t('execExpiringSoon')}
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('execClaims')}</h2>
            <div style={gridStyle}>
              <Stat value={h.openClaimsCount} label={t('execOpenClaims')} />
              <Stat
                value={h.outstandingClaimsValueJod}
                label={t('execOutstandingClaimsValueJod')}
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('execFinancial')}</h2>
            <div style={gridStyle}>
              <Stat
                value={h.receivablesOutstandingJod}
                label={t('execReceivablesOutstandingJod')}
              />
              <Stat
                value={h.payablesOutstandingJod}
                label={t('execPayablesToInsurersJod')}
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('execCompliance')}</h2>
            <div style={gridStyle}>
              <Stat
                value={h.openDsrCount}
                label={t('execOpenDataSubjectRequests')}
              />
              <Stat
                value={h.openComplianceExceptionsCount}
                label={t('execOpenComplianceExceptions')}
              />
            </div>
            <p style={{ color: 'var(--ink-secondary)', marginTop: '0.5rem' }}>
              {t('execExceptionsOpenAmlCftAlerts')}
            </p>
          </section>
        </>
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('dashLoading')} />
      )}
    </main>
  );
}
