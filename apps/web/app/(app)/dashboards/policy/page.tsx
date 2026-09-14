'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getPolicyDashboard,
  type PolicyDashboardSummary,
} from '../../../../lib/management-reporting/policy-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

export default function PolicyDashboardPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<PolicyDashboardSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [branchId, setBranchId] = useState('');
  const [insuranceLine, setInsuranceLine] = useState('');
  const [insurerId, setInsurerId] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [renewalWindowDays, setRenewalWindowDays] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setSummary(
        await getPolicyDashboard({
          branchId: branchId.trim() || undefined,
          insuranceLine: insuranceLine.trim() || undefined,
          insurerId: insurerId.trim() || undefined,
          periodLabel: periodLabel.trim() || undefined,
          periodStart: periodStart.trim() || undefined,
          periodEnd: periodEnd.trim() || undefined,
          renewalWindowDays: renewalWindowDays.trim() ? Number(renewalWindowDays.trim()) : undefined,
        }),
      );
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('dpolNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('dpolLoadError'),
      );
    }
  }, [branchId, insuranceLine, insurerId, periodLabel, periodStart, periodEnd, renewalWindowDays, t]);

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
      <h1>{t('dpolHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('dpolIntro')}
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
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {t('dpolRenewalWindowLabel')}
          <input
            aria-label={t('dpolRenewalWindowAria')}
            placeholder="90"
            value={renewalWindowDays}
            onChange={(e) => setRenewalWindowDays(e.target.value)}
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
            {summary.periodEnd.slice(0, 10)}). Renewal window: {summary.renewalWindowDays} days.
          </p>

          <section style={sectionStyle}>
            <h2>{t('dpolActivePolicies')}</h2>
            <div style={statStyle}>{summary.activePoliciesCount}</div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpolExpiringPolicies')}</h2>
            <div style={statStyle}>{summary.expiringPoliciesCount}</div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpolNewIssued')}</h2>
            <div style={statStyle}>{summary.newPoliciesIssuedCount}</div>
          </section>

          <section style={sectionStyle}>
            <h2>{t('dpolCancelled')}</h2>
            {summary.cancelledPolicies.length === 0 ? (
              <p>{t('dpolNoCancellations')}</p>
            ) : (
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dpolColPolicy')}</th>
                    <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dpolColLine')}</th>
                    <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dpolColReason')}</th>
                    <th style={{ textAlign: 'start', padding: '0.25rem 0.5rem' }}>{t('dpolColCancelledAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.cancelledPolicies.map((c) => (
                    <tr key={c.policyId}>
                      <td style={{ padding: '0.25rem 0.5rem' }}>
                        <bdi>{c.policyNumber ?? c.policyId}</bdi>
                      </td>
                      <td style={{ padding: '0.25rem 0.5rem' }}>
                        <bdi>{c.insuranceLine}</bdi>
                      </td>
                      <td style={{ padding: '0.25rem 0.5rem' }}>
                        <bdi>{c.reason}</bdi>
                      </td>
                      <td style={{ padding: '0.25rem 0.5rem' }}>{c.cancelledAt.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : loadError ? null : (
        <p>{t('dashLoading')}</p>
      )}
    </main>
  );
}
