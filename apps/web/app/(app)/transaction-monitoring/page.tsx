'use client';

import { useCallback, useEffect, useState } from 'react';
import { EntitySearch } from '../../../components/ui/EntitySearch';
import {
  ENUM_LABEL,
  isDeclaredTransactionPattern,
} from '../../../lib/i18n/enum-labels';
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
import { actionErrorText } from '../../../lib/i18n/action-error';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';


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
          ? permissionRefusal(t, 'tmRefusalAct', 'aml.monitor')
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
        actionErrorText(err, t, 'tmActionError'),
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
        t('tmSweepSummary', {
          scanned: result.scanned,
          created: result.created,
          skipped: result.skippedExisting,
          failed: result.failed,
        }),
      );
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('tmHeading')}
        description={t('tmIntro')}
      />

      {canMonitor ? (
        <>
          <form
            onSubmit={submit}
            style={{
              margin: '1rem 0',
              display: 'grid',
              gap: 'var(--space-2)',
              maxWidth: '30rem',
            }}
          >
            <EntitySearch
            kind="customer"
              value={customerId}
              onChange={setCustomerId}
              label={t('tmCustomerIdOptionalLabel')}
            />
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
            >
              {t('tmPatternLabel')}
              <select
                aria-label={t('tmPatternLabel')}
                value={patternType}
                onChange={(e) => setPatternType(e.target.value)}
              >
                {TRANSACTION_MONITORING_PATTERN_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {t(ENUM_LABEL.TransactionMonitoringPattern[p])}
                  </option>
                ))}
              </select>
            </label>
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
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
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <EmptyState title={t('tmNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('tmColCustomer')}</Th>
                  <Th>{t('tmPatternLabel')}</Th>
                  <Th>{t('tmColStatus')}</Th>
                  <Th>{t('tmColEscalated')}</Th>
                  <Th>{t('tmColReported')}</Th>
                  <Th>{t('tmColDetected')}</Th>
                  <Th>{t('tmColAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    {/*
                      * RULE 2 — the customer's NAME, resolved by the api. This rendered eight
                      * characters of a uuid, which on an AML queue is the one column the screen is
                      * about: an officer could not tell two alerts apart. The em dash is the real
                      * absent case — an alert raised against a pattern with no single customer
                      * behind it — and NOT a name the api failed to send.
                      */}
                    <Td>
                      {r.customerName ? <bdi>{r.customerName}</bdi> : t('commonNameNotResolved')}
                    </Td>
                    {/*
                      Decision 59 — and the vocabulary cost NOTHING: all five
                      `TransactionMonitoringPattern` labels have shipped in both languages for
                      months, and this cell rendered `third_party_payment_source` at an Arabic
                      reader on an AML alert queue regardless.

                      BUT NOT A TOTAL MAP, because this one genuinely is not closed:
                      `patternType` is a free `String` in the database whose five values live
                      only in a schema doc comment, so a sixth is representable TODAY and
                      `ENUM_LABEL.TransactionMonitoringPattern[x]` would be `undefined` for it.
                      `t(undefined)` is the notification-bell defect — an AML alert with no
                      words at all. So it takes OWNER DECISION 49's declared fallback: narrowed
                      by a type predicate, and the unlisted case rendered AS STORED in monospace
                      under its own tooltip, visibly machine text rather than dressed up as a
                      name. `/audit-trail`'s `entityType` is the worked example and this follows
                      it exactly, down to the two custom properties.
                    */}
                    <Td>
                      {isDeclaredTransactionPattern(r.patternType) ? (
                        t(ENUM_LABEL.TransactionMonitoringPattern[r.patternType])
                      ) : (
                        <span
                          title={t('tmPatternUnlabelled')}
                          style={{
                            fontFamily: 'var(--font-mono, monospace)',
                            color: 'var(--ink-secondary)',
                          }}
                        >
                          {r.patternType}
                        </span>
                      )}
                    </Td>
                    <Td>{t(ENUM_LABEL.TransactionMonitoringStatus[r.status])}</Td>
                    <Td>{r.escalatedToSuspiciousActivity ? t('commonYes') : t('commonNo')}</Td>
                    <Td>{r.reportedToAuthorityAt ? t('commonYes') : t('commonNo')}</Td>
                    <Td>{r.detectedAt.slice(0, 10)}</Td>
                    <Td>
                      {canMonitor && !r.isClosed ? (
                        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
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
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )
      ) : loadError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <SkeletonList rows={4} label={t('tmLoading')} />
      )}
    </main>
  );
}
