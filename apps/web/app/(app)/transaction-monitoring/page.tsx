'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  TRANSACTION_MONITORING_PATTERN_TYPES,
  closeTransactionMonitoringAlert,
  createTransactionMonitoringAlert,
  escalateTransactionMonitoringAlert,
  listTransactionMonitoringAlerts,
  reportTransactionMonitoringAlertToAuthority,
  runTransactionMonitoringSweep,
  type TransactionMonitoringAlert,
} from '../../../lib/compliance-risk/transaction-monitoring-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';


const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid var(--border-default)',
};

export default function TransactionMonitoringPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canMonitor = hasPermission(user, 'aml.monitor');

  const [rows, setRows] = useState<TransactionMonitoringAlert[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [patternType, setPatternType] = useState<string>(
    TRANSACTION_MONITORING_PATTERN_TYPES[4], // 'other'
  );
  const [detailText, setDetailText] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await listTransactionMonitoringAlerts());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('tmNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('tmLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('tmActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createTransactionMonitoringAlert({
        customerId: customerId.trim() || undefined,
        patternType,
        detailText: detailText.trim() || undefined,
      });
      setCustomerId('');
      setDetailText('');
    });
  }

  async function sweep() {
    setSweepMessage(null);
    await run(async () => {
      const result = await runTransactionMonitoringSweep();
      setSweepMessage(
        `Scanned ${result.scanned} candidate(s) — created ${result.created} alert(s), ${result.skippedExisting} already flagged, ${result.failed} failed.`,
      );
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('tmHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('tmIntro')}
      </p>

      {canMonitor ? (
        <>
          <form
            onSubmit={submit}
            style={{
              margin: '1rem 0',
              display: 'grid',
              gap: '0.4rem',
              maxWidth: '30rem',
            }}
          >
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
            >
              {t('tmCustomerIdOptionalLabel')}
              <input
                aria-label={t('tmCustomerIdLabel')}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              />
            </label>
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
            >
              {t('tmPatternLabel')}
              <select
                aria-label={t('tmPatternLabel')}
                value={patternType}
                onChange={(e) => setPatternType(e.target.value)}
              >
                {TRANSACTION_MONITORING_PATTERN_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}
            >
              {t('tmDetailLabel')}
              <textarea
                aria-label={t('tmDetailLabel')}
                value={detailText}
                onChange={(e) => setDetailText(e.target.value)}
                rows={3}
              />
            </label>
            <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
              {busy ? t('tmSavingButton') : t('tmLogButton')}
            </button>
          </form>
          <button type="button" disabled={busy} onClick={() => void sweep()}>
            {t('tmRunSweepButton')}
          </button>
          {sweepMessage ? <p style={{ opacity: 0.75 }}>{sweepMessage}</p> : null}
        </>
      ) : null}

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>{t('tmNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '55rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('tmColCustomer')}</th>
                  <th style={head}>{t('tmPatternLabel')}</th>
                  <th style={head}>{t('tmColStatus')}</th>
                  <th style={head}>{t('tmColEscalated')}</th>
                  <th style={head}>{t('tmColReported')}</th>
                  <th style={head}>{t('tmColDetected')}</th>
                  <th style={head}>{t('tmColAction')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.customerId ? `${r.customerId.slice(0, 8)}…` : '—'}</td>
                    <td style={cell}>{r.patternType}</td>
                    <td style={cell}>{t(ENUM_LABEL.TransactionMonitoringStatus[r.status])}</td>
                    <td style={cell}>{r.escalatedToSuspiciousActivity ? 'yes' : 'no'}</td>
                    <td style={cell}>{r.reportedToAuthorityAt ? 'yes' : 'no'}</td>
                    <td style={cell}>{r.detectedAt.slice(0, 10)}</td>
                    <td style={cell}>
                      {canMonitor && !r.isClosed ? (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {!r.escalatedToSuspiciousActivity ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => escalateTransactionMonitoringAlert(r.id))
                              }
                            >
                              {t('tmEscalateButton')}
                            </button>
                          ) : !r.reportedToAuthorityAt ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  reportTransactionMonitoringAlertToAuthority(r.id),
                                )
                              }
                            >
                              {t('tmReportButton')}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => closeTransactionMonitoringAlert(r.id))}
                          >
                            {t('tmCloseButton')}
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <p>{t('tmLoading')}</p>
      )}
    </main>
  );
}
