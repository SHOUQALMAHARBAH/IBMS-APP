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
import { useLanguage } from '../../../../lib/i18n/language-context';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

export default function SalesDashboardPage() {
  const { t } = useLanguage();
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
  }, [isLoading, user, router, t]);

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
          ? t('dsalNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('dsalLoadError'),
      );
    }
  }, [branchId, insuranceLine, insurerId, periodLabel, periodStart, periodEnd, t]);

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
      <h1>{t('dsalHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('dsalIntro')}
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
          {t('dashPeriodLabel')}
          <input
            aria-label={t('dashPeriodLabel')}
            placeholder={t('dashPeriodLabelPlaceholder')}
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {t('dashPeriodStart')}
          <input
            aria-label={t('dashPeriodStart')}
            placeholder={t('dashDatePlaceholder')}
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {t('dashPeriodEnd')}
          <input
            aria-label={t('dashPeriodEnd')}
            placeholder={t('dashDatePlaceholder')}
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
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
          <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>
            Period {summary.periodLabel} ({summary.periodStart.slice(0, 10)} –{' '}
            {summary.periodEnd.slice(0, 10)}).
          </p>

          <section style={sectionStyle}>
            <h2>{t('kpiLeads')}</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.leads.newLeadsCount}</div>
                <div>{t('dsalNewLeads')}</div>
              </div>
              <div>
                <div style={statStyle}>{summary.leads.convertedToProspectCount}</div>
                <div>{t('dsalConvertedToProspect')}</div>
              </div>
              <div>
                <div style={statStyle}>{summary.leads.conversionRatePercent}%</div>
                <div>{t('dsalConversionRate')}</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dsalPremiumWritten')}</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.premiumWritten.newJod}</div>
                <div>{t('dsalNewBusiness')}</div>
              </div>
              <div>
                <div style={statStyle}>{summary.premiumWritten.renewalJod}</div>
                <div>{t('dsalRenewal')}</div>
              </div>
              <div>
                <div style={statStyle}>{summary.premiumWritten.totalJod}</div>
                <div>{t('dsalTotal')}</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dsalCommissionIncome')}</h2>
            <div style={statStyle}>{summary.commissionIncomeJod} JOD</div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dsalCrossSellConversion')}</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.crossSell.totalCount}</div>
                <div>{t('dsalOpportunities')}</div>
              </div>
              <div>
                <div style={statStyle}>{summary.crossSell.convertedCount}</div>
                <div>{t('dsalConverted')}</div>
              </div>
              <div>
                <div style={statStyle}>{summary.crossSell.conversionRatePercent}%</div>
                <div>{t('dsalConversionRate')}</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dsalUpSellConversion')}</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.upSell.totalCount}</div>
                <div>{t('dsalRecommendations')}</div>
              </div>
              <div>
                <div style={statStyle}>{summary.upSell.convertedCount}</div>
                <div>{t('dsalConverted')}</div>
              </div>
              <div>
                <div style={statStyle}>{summary.upSell.conversionRatePercent}%</div>
                <div>{t('dsalConversionRate')}</div>
              </div>
            </div>
          </section>
        </>
      ) : loadError ? null : (
        <p>{t('dashLoading')}</p>
      )}
    </main>
  );
}
