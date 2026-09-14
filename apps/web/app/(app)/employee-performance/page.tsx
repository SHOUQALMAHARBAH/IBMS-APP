'use client';

import { type CSSProperties, type FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  computeEmployeePerformance,
  listEmployeePerformance,
  type EmployeePerformanceRecord,
} from '../../../lib/management-reporting/employee-performance-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const statRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', margin: '1rem 0' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
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

function displayOrDash(value: string | number | null): string {
  return value === null ? '—' : String(value);
}

export default function EmployeePerformancePage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [employeeId, setEmployeeId] = useState('');
  const [history, setHistory] = useState<EmployeePerformanceRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLookedUp, setHasLookedUp] = useState(false);

  const [computePeriodStart, setComputePeriodStart] = useState('');
  const [computePeriodEnd, setComputePeriodEnd] = useState('');
  const [computePeriodLabel, setComputePeriodLabel] = useState('');
  const [computeError, setComputeError] = useState<string | null>(null);
  const [computeMessage, setComputeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  async function onLookup(e: FormEvent) {
    e.preventDefault();
    try {
      setHistory(await listEmployeePerformance({ employeeId }));
      setLoadError(null);
    } catch (err) {
      setHistory(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('epNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('epLoadError'),
      );
    } finally {
      setHasLookedUp(true);
    }
  }

  async function onCompute(e: FormEvent) {
    e.preventDefault();
    setComputeError(null);
    setComputeMessage(null);
    try {
      const useDefaultPeriod = !computePeriodLabel && !computePeriodStart && !computePeriodEnd;
      await computeEmployeePerformance(
        useDefaultPeriod
          ? { employeeId }
          : {
              employeeId,
              periodLabel: computePeriodLabel,
              periodStart: computePeriodStart,
              periodEnd: computePeriodEnd,
            },
      );
      setComputeMessage(t('epComputed'));
      setHistory(await listEmployeePerformance({ employeeId }));
    } catch (err) {
      setComputeError(
        err instanceof ApiError ? err.message : t('epComputeError'),
      );
    }
  }

  if (isLoading || !user) return null;

  const latest = history && history.length > 0 ? history[0] : null;

  return (
    <main style={pageStyle}>
      <h1>{t('epHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('epIntro')}
      </p>

      <form onSubmit={onLookup} style={formStyle}>
        <h2>{t('epLookUp')}</h2>
        <label style={labelStyle}>
          {t('epEmployeeIdLabel')}
          <input
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            required
          />
        </label>
        <button type="submit">{t('epViewButton')}</button>
      </form>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {latest ? (
        <>
          <div style={statRow}>
            <Stat label={t('diepNewClients')} value={displayOrDash(latest.newClients)} />
            <Stat
              label={t('epPremiumWrittenJod')}
              value={displayOrDash(latest.premiumWrittenJod)}
            />
            <Stat
              label={t('epCommissionEarnedJod')}
              value={displayOrDash(latest.commissionEarnedJod)}
            />
            <Stat
              label={t('diepRenewalRate')}
              value={
                latest.renewalRatePercent === null
                  ? '—'
                  : `${latest.renewalRatePercent}%`
              }
            />
            <Stat
              label={t('diepCrossSellRate')}
              value={
                latest.crossSellRatePercent === null
                  ? '—'
                  : `${latest.crossSellRatePercent}%`
              }
            />
          </div>
          <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>
            Most recent period: {latest.periodLabel}. A dash means no outcomes
            existed to rate that period, not a computed 0%.
          </p>

          <h2>{t('dashHistory')}</h2>
          <table style={{ borderCollapse: 'collapse', minWidth: '30rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('dashColPeriod')}</th>
                <th style={head}>{t('diepNewClients')}</th>
                <th style={head}>{t('diepPremiumWritten')}</th>
                <th style={head}>{t('diepCommissionEarned')}</th>
                <th style={head}>{t('diepRenewalRate')}</th>
                <th style={head}>{t('diepCrossSellRate')}</th>
              </tr>
            </thead>
            <tbody>
              {history!.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>{row.periodLabel}</td>
                  <td style={cell}>{displayOrDash(row.newClients)}</td>
                  <td style={cell}>{displayOrDash(row.premiumWrittenJod)}</td>
                  <td style={cell}>{displayOrDash(row.commissionEarnedJod)}</td>
                  <td style={cell}>
                    {row.renewalRatePercent === null
                      ? '—'
                      : `${row.renewalRatePercent}%`}
                  </td>
                  <td style={cell}>
                    {row.crossSellRatePercent === null
                      ? '—'
                      : `${row.crossSellRatePercent}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : hasLookedUp && !loadError ? (
        <p style={{ opacity: 0.6 }}>{t('epNoRecord')}</p>
      ) : null}

      <form onSubmit={onCompute} style={formStyle}>
        <h2>{t('epComputeNow')}</h2>
        <p style={{ opacity: 0.7, fontSize: '0.85rem', margin: 0 }}>
          {t('epComputeNote')}
        </p>
        <label style={labelStyle}>
          {t('ipPeriodOptionalLabel')}
          <input
            value={computePeriodLabel}
            onChange={(e) => setComputePeriodLabel(e.target.value)}
          />
        </label>
        <label style={labelStyle}>
          {t('ipPeriodStartOptionalLabel')}
          <input
            type="date"
            value={computePeriodStart}
            onChange={(e) => setComputePeriodStart(e.target.value)}
          />
        </label>
        <label style={labelStyle}>
          {t('ipPeriodEndOptionalLabel')}
          <input
            type="date"
            value={computePeriodEnd}
            onChange={(e) => setComputePeriodEnd(e.target.value)}
          />
        </label>
        <button type="submit" disabled={!employeeId}>
          {t('epComputeButton')}
        </button>
        {computeError ? (
          <p role="alert" style={errorStyle}>
            {computeError}
          </p>
        ) : null}
        {computeMessage ? <p>{computeMessage}</p> : null}
      </form>
    </main>
  );
}
