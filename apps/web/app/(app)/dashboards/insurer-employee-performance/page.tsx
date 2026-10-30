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
import {
  Card,
  ErrorState,
  PageHeader,
  Table,
  Td,
  Th,
  Tr,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import {
  loadIndependently,
  namedFailures,
} from '../../../../lib/load-independently';
import { permissionRefusalAllOf } from '../../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../../components/ui/EntitySearch';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('diepHeading')}
        description={t('diepIntro')}
      />

      <form
        onSubmit={applyFilters}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {t('dashPeriodLabel')}
          <input
            aria-label={t('dashPeriodLabel')}
            placeholder={t('dashPeriodLabelPlaceholder')}
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
          />
        </label>
        <EntitySearch
          kind="insurer"
          value={insurerId}
          onChange={setInsurerId}
          label={t('diepInsurerIdScopedLabel')}
        />
        <EntitySearch
          kind="branch"
          value={branchId}
          onChange={setBranchId}
          label={t('diepBranchIdScopedLabel')}
        />
        <button type="submit">{t('dashApplyFilters')}</button>
      </form>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      <section style={sectionStyle}>
        <h2>{t('diepInsurerSection')}</h2>
        {insurerScores === null ? null : insurerScores.length === 0 ? (
          <p>{t('diepNoInsurerScores')}</p>
        ) : (
          <Card padded={false}>
            <Table>
            <thead>
              <tr>
                <Th>{t('diepColInsurer')}</Th>
                <Th>{t('diepQuoteResponse')}</Th>
                <Th>{t('diepClaimsService')}</Th>
                <Th>{t('diepPrice')}</Th>
                <Th>{t('diepServiceQuality')}</Th>
              </tr>
            </thead>
            <tbody>
              {insurerScores.map((row) => (
                <Tr key={row.id}>
                  {/* ITEM 1 — the company's name, resolved by the api. An em dash where the
                      insurer row is gone: "we hold no name" and "the name is this uuid" are
                      different claims and only the first one is true. */}
                  <Td>
                    {row.insurerName ? <bdi>{row.insurerName}</bdi> : t('commonNameNotResolved')}
                  </Td>
                  <Td>{row.quoteResponseScore}</Td>
                  <Td>{row.claimsServiceScore}</Td>
                  <Td>{row.priceScore}</Td>
                  <Td>{row.serviceQualityScore}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          </Card>
        )}
      </section>

      <section style={sectionStyle}>
        <h2>{t('diepEmployeeSection')}</h2>
        {employeeRecords === null ? null : employeeRecords.length === 0 ? (
          <p>{t('diepNoEmployeeRecords')}</p>
        ) : (
          <Card padded={false}>
            <Table>
            <thead>
              <tr>
                <Th>{t('diepColEmployee')}</Th>
                <Th>{t('diepNewClients')}</Th>
                <Th>{t('diepPremiumWritten')}</Th>
                <Th>{t('diepCommissionEarned')}</Th>
                <Th>{t('diepRenewalRate')}</Th>
                <Th>{t('diepCrossSellRate')}</Th>
              </tr>
            </thead>
            <tbody>
              {employeeRecords.map((row) => (
                <Tr key={row.id}>
                  {/* ITEM 1 — the colleague's name from their HR record, resolved by the api. */}
                  <Td>
                    {row.employeeName ? <bdi>{row.employeeName}</bdi> : t('commonNameNotResolved')}
                  </Td>
                  <Td>{displayOrDash(row.newClients)}</Td>
                  <Td>{displayOrDash(row.premiumWrittenJod)}</Td>
                  <Td>{displayOrDash(row.commissionEarnedJod)}</Td>
                  <Td>{row.renewalRatePercent === null ? '—' : `${row.renewalRatePercent}%`}</Td>
                  <Td>{row.crossSellRatePercent === null ? '—' : `${row.crossSellRatePercent}%`}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          </Card>
        )}
      </section>
    </main>
  );
}
