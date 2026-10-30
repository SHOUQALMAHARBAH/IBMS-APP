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
import {
  Card,
  DateEcho,
  EmptyState,
  ErrorState,
  Hint,
  PageHeader,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../components/ui/EntitySearch';

const statRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', margin: '1rem 0' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: 'var(--space-2)', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
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
          ? permissionRefusal(t, 'epRefusalAct', 'employee-performance.view')
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('epHeading')}
        description={t('epIntro')}
      />

      <form onSubmit={onLookup} style={formStyle}>
        <h2>{t('epLookUp')}</h2>
        <EntitySearch
          kind="employee"
          value={employeeId}
          onChange={setEmployeeId}
          label={t('epEmployeeIdLabel')}
          required
        />
        <button type="submit">{t('epViewButton')}</button>
      </form>

      {loadError ? (
        <ErrorState title={loadError} />
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
            {t('epMostRecentPeriod', { period: latest.periodLabel })}{' '}
            {t('epDashMeaning')}
          </p>

          <h2>{t('dashHistory')}</h2>
          <Card padded={false}>
            <Table>
            <thead>
              <tr>
                <Th>{t('dashColPeriod')}</Th>
                <Th>{t('diepNewClients')}</Th>
                <Th>{t('diepPremiumWritten')}</Th>
                <Th>{t('diepCommissionEarned')}</Th>
                <Th>{t('diepRenewalRate')}</Th>
                <Th>{t('diepCrossSellRate')}</Th>
              </tr>
            </thead>
            <tbody>
              {history!.map((row) => (
                <Tr key={row.id}>
                  <Td>{row.periodLabel}</Td>
                  <Td>{displayOrDash(row.newClients)}</Td>
                  <Td>{displayOrDash(row.premiumWrittenJod)}</Td>
                  <Td>{displayOrDash(row.commissionEarnedJod)}</Td>
                  <Td>
                    {row.renewalRatePercent === null
                      ? '—'
                      : `${row.renewalRatePercent}%`}
                  </Td>
                  <Td>
                    {row.crossSellRatePercent === null
                      ? '—'
                      : `${row.crossSellRatePercent}%`}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          </Card>
        </>
      ) : hasLookedUp && !loadError ? (
        <EmptyState title={t('epNoRecord')} />
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
        <div style={labelStyle}>
          <label htmlFor="ep-period-start">{t('ipPeriodStartOptionalLabel')}</label>
          <input
            id="ep-period-start"
            aria-describedby="ep-period-start-hint"
            type="date"
            value={computePeriodStart}
            onChange={(e) => setComputePeriodStart(e.target.value)}
          />
          <Hint id="ep-period-start-hint">{t('ipPeriodStartHint')}</Hint>
          <DateEcho value={computePeriodStart} />
        </div>
        <div style={labelStyle}>
          <label htmlFor="ep-period-end">{t('ipPeriodEndOptionalLabel')}</label>
          <input
            id="ep-period-end"
            aria-describedby="ep-period-end-hint"
            type="date"
            value={computePeriodEnd}
            onChange={(e) => setComputePeriodEnd(e.target.value)}
          />
          <Hint id="ep-period-end-hint">{t('ipPeriodEndHint')}</Hint>
          <DateEcho value={computePeriodEnd} />
        </div>
        <button type="submit" disabled={!employeeId}>
          {t('epComputeButton')}
        </button>
        {computeError ? (
          <ErrorState title={computeError} />
        ) : null}
        {computeMessage ? <p>{computeMessage}</p> : null}
      </form>
    </main>
  );
}
