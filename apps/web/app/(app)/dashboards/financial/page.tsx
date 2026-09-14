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
import { useLanguage } from '../../../../lib/i18n/language-context';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

function ProfitabilityTable({ title, rows }: { title: string; rows: ProfitabilityRow[] }) {
  const { t } = useLanguage();
  return (
    <section style={sectionStyle}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p>{t('dashNoData')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dashColGroup')}</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dfinColPremium')}</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dfinColClaims')}</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dfinColCommission')}</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dfinColNetPosition')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: '0.25rem 0.5rem' }}>
                  <bdi>{r.label}</bdi>
                </td>
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
  const { t } = useLanguage();
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
  }, [isLoading, user, router, t]);

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
          ? t('dfinNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('dfinLoadError'),
      );
    }
  }, [branchId, insuranceLine, insurerId, asOf, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
    // Filters apply on explicit "Apply filters" submit only — see below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, t]);

  function applyFilters(ev: React.FormEvent) {
    ev.preventDefault();
    void load();
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('dfinHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('dfinIntro')}
      </p>

      <form
        onSubmit={applyFilters}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {t('dashBranchIdLabel')}
          <input aria-label={t('dashBranchIdFilterAria')} value={branchId} onChange={(e) => setBranchId(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {t('dashInsuranceLineLabel')}
          <input
            aria-label={t('dashInsuranceLineFilterAria')}
            dir="auto"
            value={insuranceLine}
            onChange={(e) => setInsuranceLine(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {t('dashInsurerIdLabel')}
          <input aria-label={t('dashInsurerIdFilterAria')} value={insurerId} onChange={(e) => setInsurerId(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {t('dashAsOf')}
          <input aria-label={t('dashAsOfDateAria')} placeholder={t('dashDatePlaceholder')} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <button type="submit">{t('dashApplyFilters')}</button>
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
            <h2>{t('dfinReceivables')}</h2>
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
            <h2>{t('dfinPayables')}</h2>
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
            <h2>{t('dfinCommissionIncome')}</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.commission.earned} JOD</div>
                <div>{t('dfinEarned')}</div>
              </div>
              <div>
                <div style={statStyle}>{summary.commission.outstanding} JOD</div>
                <div>{t('dfinOutstanding')}</div>
              </div>
              <div>
                <div style={statStyle}>{summary.commission.paid} JOD</div>
                <div>{t('dfinPaid')}</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dfinProfitability')}</h2>
            <ProfitabilityTable title={t('dfinByLine')} rows={summary.profitability.byLine} />
            <ProfitabilityTable title={t('dfinByClientSegment')} rows={summary.profitability.bySegment} />
          </section>
        </>
      ) : loadError ? null : (
        <p>{t('dashLoading')}</p>
      )}
    </main>
  );
}
