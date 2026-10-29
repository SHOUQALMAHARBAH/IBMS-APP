'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { FigurePeriod } from '../../../../components/ui';
import { ReportProvenance } from '../../../../components/ui/ReportProvenance';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getSalesDashboard,
  type SalesDashboardSummary,
} from '../../../../lib/management-reporting/sales-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  ErrorState,
  PageHeader,
  SkeletonList,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { formatMoney } from '../../../../lib/i18n/format';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../../components/ui/EntitySearch';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

/**
 * The rate with no denominator — item 5 batch 1, the owner's ruling. A cohort with nothing in it has NO
 * conversion rate, and 0% would be a claim about performance where none was measured. The same em dash the
 * employee-performance and sales-performance screens already used, so one concept now has one rendering.
 */
const EM_DASH = '—';

export default function SalesDashboardPage() {
  const { t, language } = useLanguage();
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
          ? permissionRefusal(t, 'dsalRefusalAct', 'dashboard.sales.view')
          : err instanceof ApiError
            ? err.message
            : t('dsalLoadError'),
      );
    }
  }, [
    branchId,
    insuranceLine,
    insurerId,
    periodLabel,
    periodStart,
    periodEnd,
    t,
  ]);

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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('dsalHeading')}
        description={t('dsalIntro')}
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
          label={t('dashBranchIdLabel')}
        />
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          {t('dashInsuranceLineLabel')}
          <input
            aria-label={t('dashInsuranceLineFilterAria')}
            dir="auto"
            value={insuranceLine}
            onChange={(e) => setInsuranceLine(e.target.value)}
          />
        </label>
        <EntitySearch
          kind="insurer"
          value={insurerId}
          onChange={setInsurerId}
          label={t('dashInsurerIdLabel')}
        />
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          {t('dashPeriodLabel')}
          <input
            aria-label={t('dashPeriodLabel')}
            placeholder={t('dashPeriodLabelPlaceholder')}
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
          />
        </label>
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          {t('dashPeriodStart')}
          <input
            aria-label={t('dashPeriodStart')}
            placeholder={t('dashDatePlaceholder')}
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </label>
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
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
        <ErrorState title={loadError} />
      ) : null}

      {summary ? (
        <>
          <ReportProvenance
            kind="period"
            periodLabel={summary.periodLabel}
            from={summary.periodStart}
            to={summary.periodEnd}
          />

          <section style={sectionStyle}>
            <h2>{t('kpiLeads')}</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.leads.newLeadsCount}</div>
                <div>{t('dsalNewLeads')}</div>
                <FigurePeriod
                  scope={summary.metricScope.leads}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-leads-new"
                />
              </div>
              <div>
                <div style={statStyle}>
                  {summary.leads.convertedToProspectCount}
                </div>
                <div>{t('dsalConvertedToProspect')}</div>
                <FigurePeriod
                  scope={summary.metricScope.leads}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-leads-converted"
                />
              </div>
              <div>
                <div style={statStyle}>
                  {summary.leads.conversionRatePercent === null
                    ? EM_DASH
                    : `${summary.leads.conversionRatePercent}%`}
                </div>
                <div>{t('dsalConversionRate')}</div>
                <FigurePeriod
                  scope={summary.metricScope.leads}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-leads-rate"
                />
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dsalPremiumWritten')}</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.premiumWritten.newJod}</div>
                <div>{t('dsalNewBusiness')}</div>
                <FigurePeriod
                  scope={summary.metricScope.premiumWritten}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-premium-new"
                />
              </div>
              <div>
                <div style={statStyle}>{summary.premiumWritten.renewalJod}</div>
                <div>{t('dsalRenewal')}</div>
                <FigurePeriod
                  scope={summary.metricScope.premiumWritten}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-premium-renewal"
                />
              </div>
              <div>
                <div style={statStyle}>{summary.premiumWritten.totalJod}</div>
                <div>{t('dsalTotal')}</div>
                <FigurePeriod
                  scope={summary.metricScope.premiumWritten}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-premium-total"
                />
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dsalCommissionIncome')}</h2>
            <div style={statStyle}>
              {formatMoney(summary.commissionIncomeJod, language)}
            </div>
            <FigurePeriod
              scope={summary.metricScope.commissionIncomeJod}
              periodLabel={summary.periodLabel}
              generatedAt={summary.generatedAt}
              testId="dsal-commission"
            />
          </section>

          <section style={sectionStyle}>
            <h2>{t('dsalCrossSellConversion')}</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.crossSell.totalCount}</div>
                <div>{t('dsalOpportunities')}</div>
                <FigurePeriod
                  scope={summary.metricScope.crossSell}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-crosssell-total"
                />
              </div>
              <div>
                <div style={statStyle}>{summary.crossSell.convertedCount}</div>
                <div>{t('dsalConverted')}</div>
                <FigurePeriod
                  scope={summary.metricScope.crossSell}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-crosssell-converted"
                />
              </div>
              <div>
                <div style={statStyle}>
                  {summary.crossSell.conversionRatePercent === null
                    ? EM_DASH
                    : `${summary.crossSell.conversionRatePercent}%`}
                </div>
                <div>{t('dsalConversionRate')}</div>
                <FigurePeriod
                  scope={summary.metricScope.crossSell}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-crosssell-rate"
                />
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dsalUpSellConversion')}</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.upSell.totalCount}</div>
                <div>{t('dsalRecommendations')}</div>
                <FigurePeriod
                  scope={summary.metricScope.upSell}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-upsell-total"
                />
              </div>
              <div>
                <div style={statStyle}>{summary.upSell.convertedCount}</div>
                <div>{t('dsalConverted')}</div>
                <FigurePeriod
                  scope={summary.metricScope.upSell}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-upsell-converted"
                />
              </div>
              <div>
                <div style={statStyle}>
                  {summary.upSell.conversionRatePercent === null
                    ? EM_DASH
                    : `${summary.upSell.conversionRatePercent}%`}
                </div>
                <div>{t('dsalConversionRate')}</div>
                <FigurePeriod
                  scope={summary.metricScope.upSell}
                  periodLabel={summary.periodLabel}
                  generatedAt={summary.generatedAt}
                  testId="dsal-upsell-rate"
                />
              </div>
            </div>
          </section>
        </>
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('dashLoading')} />
      )}
    </main>
  );
}
