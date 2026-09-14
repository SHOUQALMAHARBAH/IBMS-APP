'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getExecutiveDashboard,
  type ExecutiveDashboardSummary,
} from '../../../../lib/management-reporting/executive-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';

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

  const [summary, setSummary] = useState<ExecutiveDashboardSummary | null>(null);
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
          ? t('execNoPermission')
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
    <main style={pageStyle}>
      <h1>
        {t('execExecutiveDashboard')}
      </h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('execTheSalesPolicyClaimsFinancial')}
      </p>

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
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {t('execBranchId')}
          <input
            aria-label={t('dashBranchIdFilterAria')}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {t('execInsuranceLine')}
          <input
            aria-label={t('dashInsuranceLineFilterAria')}
            value={insuranceLine}
            onChange={(e) => setInsuranceLine(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {t('execAsOf')}
          <input
            aria-label={t('dashAsOfDateAria')}
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <button type="submit">
          {t('execApplyFilters')}
        </button>
      </form>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {summary && h ? (
        <>
          <p style={{ opacity: 0.6 }}>
            {t('execPeriodAsOf', {
              period: summary.periodLabel,
              asOf: summary.asOf.slice(0, 10),
            })}
          </p>

          <section style={sectionStyle}>
            <h2>{t('execSales')}</h2>
            <div style={gridStyle}>
              <Stat
                value={h.newLeadsCount}
                label={t('execNewLeads')}
              />
              <Stat
                value={`${h.leadConversionRatePercent}%`}
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
              <Stat
                value={h.openClaimsCount}
                label={t('execOpenClaims')}
              />
              <Stat
                value={h.outstandingClaimsValueJod}
                label={
                  t('execOutstandingClaimsValueJod')
                }
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('execFinancial')}</h2>
            <div style={gridStyle}>
              <Stat
                value={h.receivablesOutstandingJod}
                label={
                  t('execReceivablesOutstandingJod')
                }
              />
              <Stat
                value={h.payablesOutstandingJod}
                label={
                  t('execPayablesToInsurersJod')
                }
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('execCompliance')}</h2>
            <div style={gridStyle}>
              <Stat
                value={h.openDsrCount}
                label={
                  t('execOpenDataSubjectRequests')
                }
              />
              <Stat
                value={h.openComplianceExceptionsCount}
                label={
                  t('execOpenComplianceExceptions')
                }
              />
            </div>
            <p style={{ opacity: 0.6, marginTop: '0.5rem' }}>
              {t('execExceptionsOpenAmlCftAlerts')}
            </p>
          </section>
        </>
      ) : loadError ? null : (
        <p>{t('dashLoading')}</p>
      )}
    </main>
  );
}
