'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getClaimsDashboard,
  type ClaimsDashboardSummary,
  type LossRatioBreakdownRow,
} from '../../../../lib/management-reporting/claims-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

function LossRatioTable({ title, rows }: { title: string; rows: LossRatioBreakdownRow[] }) {
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
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dclmColClaims')}</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dclmColPremium')}</th>
              <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dclmColRatio')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: '0.25rem 0.5rem' }}>
                  <bdi>{r.label}</bdi>
                </td>
                <td style={{ padding: '0.25rem 0.5rem' }}>{r.periodClaims}</td>
                <td style={{ padding: '0.25rem 0.5rem' }}>{r.periodPremium}</td>
                <td style={{ padding: '0.25rem 0.5rem' }}>
                  {r.ratio}
                  {r.ratioCapped ? ' (capped)' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function ClaimsDashboardPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<ClaimsDashboardSummary | null>(null);
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
        await getClaimsDashboard({
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
          ? t('dclmNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('dclmLoadError'),
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
      <h1>{t('dclmHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('dclmIntro')}
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
          <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>As of {summary.asOf.slice(0, 10)}.</p>

          <section style={sectionStyle}>
            <h2>{t('dclmOpenVsClosed')}</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.openClaimsCount}</div>
                <div>{t('dclmOpen')}</div>
              </div>
              <div>
                <div style={statStyle}>{summary.closedClaimsCount}</div>
                <div>{t('dclmClosed')}</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dclmOutstandingValue')}</h2>
            <div style={statStyle}>{summary.outstandingClaimsValueJod} JOD</div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dclmAgeing')}</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.ageing.d0_30.count}</div>
                <div>0-30 days ({summary.ageing.d0_30.valueJod} JOD)</div>
              </div>
              <div>
                <div style={statStyle}>{summary.ageing.d31_60.count}</div>
                <div>31-60 days ({summary.ageing.d31_60.valueJod} JOD)</div>
              </div>
              <div>
                <div style={statStyle}>{summary.ageing.d61_90.count}</div>
                <div>61-90 days ({summary.ageing.d61_90.valueJod} JOD)</div>
              </div>
              <div>
                <div style={statStyle}>{summary.ageing.d90_plus.count}</div>
                <div>90+ days ({summary.ageing.d90_plus.valueJod} JOD)</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dclmLossRatio')}</h2>
            <LossRatioTable title={t('dclmByClient')} rows={summary.lossRatioByClient} />
            <LossRatioTable title={t('dclmByLine')} rows={summary.lossRatioByLine} />
            <LossRatioTable title={t('dclmByInsurer')} rows={summary.lossRatioByInsurer} />
          </section>
        </>
      ) : loadError ? null : (
        <p>{t('dashLoading')}</p>
      )}
    </main>
  );
}
