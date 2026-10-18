'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  listInsurerPerformance,
  type InsurerPerformanceScore,
} from '../../../../lib/management-reporting/insurer-performance-api';
import {
  listEmployeePerformance,
  type EmployeePerformanceRecord,
} from '../../../../lib/management-reporting/employee-performance-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import {
  loadIndependently,
  namedFailures,
} from '../../../../lib/load-independently';
import { permissionRefusalAllOf } from '../../../../lib/i18n/permission-refusal';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const cell: CSSProperties = { padding: '0.35rem 0.75rem', borderBottom: '1px solid var(--border-subtle)', textAlign: 'start' };
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };

function previousUtcMonthLabel(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function displayOrDash(value: string | number | null): string {
  return value === null ? '—' : String(value);
}

export default function InsurerEmployeePerformanceDashboardPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [periodLabel, setPeriodLabel] = useState(previousUtcMonthLabel());
  const [branchId, setBranchId] = useState('');
  const [insurerId, setInsurerId] = useState('');

  const [insurerScores, setInsurerScores] = useState<InsurerPerformanceScore[] | null>(null);
  const [employeeRecords, setEmployeeRecords] = useState<EmployeePerformanceRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  /*
   * ITEM 8 — the OTHER screen CLAUDE.md named. Two panels behind two separate codes, and holding
   * one of them used to show neither: `insurer-performance.view` without
   * `employee-performance.view` produced an empty screen and a sentence naming both. The all-of
   * refusal stays for the reader who holds neither.
   */
  const load = useCallback(async () => {
    const { values, failures } = await loadIndependently([
      {
        key: 'scores',
        label: t('diepListInsurerScores'),
        load: () =>
          listInsurerPerformance({
            periodLabel: periodLabel.trim() || undefined,
            insurerId: insurerId.trim() || undefined,
          }),
      },
      {
        key: 'records',
        label: t('diepListEmployeeRecords'),
        load: () =>
          listEmployeePerformance({
            periodLabel: periodLabel.trim() || undefined,
            branchId: branchId.trim() || undefined,
          }),
      },
    ]);
    setInsurerScores((values.scores as InsurerPerformanceScore[] | undefined) ?? null);
    setEmployeeRecords(
      (values.records as EmployeePerformanceRecord[] | undefined) ?? null,
    );
    const allRefused =
      failures.length === 2 &&
      failures.every((f) => f.error instanceof ApiError && f.error.status === 403);
    setLoadError(
      failures.length === 0
        ? null
        : allRefused
          ? permissionRefusalAllOf(t, 'diepRefusalAct', [
              'insurer-performance.view',
              'employee-performance.view',
            ])
          : `${t('commonListsMissing')} ${namedFailures(failures)}`,
    );
  }, [periodLabel, branchId, insurerId, t]);

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
      <h1>{t('diepHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('diepIntro')}
      </p>

      <form
        onSubmit={applyFilters}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
      >
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
          {t('diepInsurerIdScopedLabel')}
          <input aria-label={t('dashInsurerIdFilterAria')} value={insurerId} onChange={(e) => setInsurerId(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {t('diepBranchIdScopedLabel')}
          <input aria-label={t('dashBranchIdFilterAria')} value={branchId} onChange={(e) => setBranchId(e.target.value)} />
        </label>
        <button type="submit">{t('dashApplyFilters')}</button>
      </form>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      <section style={sectionStyle}>
        <h2>{t('diepInsurerSection')}</h2>
        {insurerScores === null ? null : insurerScores.length === 0 ? (
          <p>{t('diepNoInsurerScores')}</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('diepColInsurerId')}</th>
                <th style={head}>{t('diepQuoteResponse')}</th>
                <th style={head}>{t('diepClaimsService')}</th>
                <th style={head}>{t('diepPrice')}</th>
                <th style={head}>{t('diepServiceQuality')}</th>
              </tr>
            </thead>
            <tbody>
              {insurerScores.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>{row.insurerId}</td>
                  <td style={cell}>{row.quoteResponseScore}</td>
                  <td style={cell}>{row.claimsServiceScore}</td>
                  <td style={cell}>{row.priceScore}</td>
                  <td style={cell}>{row.serviceQualityScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={sectionStyle}>
        <h2>{t('diepEmployeeSection')}</h2>
        {employeeRecords === null ? null : employeeRecords.length === 0 ? (
          <p>{t('diepNoEmployeeRecords')}</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('diepColEmployeeId')}</th>
                <th style={head}>{t('diepNewClients')}</th>
                <th style={head}>{t('diepPremiumWritten')}</th>
                <th style={head}>{t('diepCommissionEarned')}</th>
                <th style={head}>{t('diepRenewalRate')}</th>
                <th style={head}>{t('diepCrossSellRate')}</th>
              </tr>
            </thead>
            <tbody>
              {employeeRecords.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>{row.employeeId}</td>
                  <td style={cell}>{displayOrDash(row.newClients)}</td>
                  <td style={cell}>{displayOrDash(row.premiumWrittenJod)}</td>
                  <td style={cell}>{displayOrDash(row.commissionEarnedJod)}</td>
                  <td style={cell}>{row.renewalRatePercent === null ? '—' : `${row.renewalRatePercent}%`}</td>
                  <td style={cell}>{row.crossSellRatePercent === null ? '—' : `${row.crossSellRatePercent}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
