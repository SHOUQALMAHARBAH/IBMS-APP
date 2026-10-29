'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  detectReconciliation,
  investigateReconciliationException,
  listReconciliationExceptions,
  resolveReconciliationException,
  type DetectResult,
  type ReconciliationException,
} from '../../../lib/finance/reconciliation-api';
import { ApiError } from '../../../lib/auth/api-client';
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



/** Parse a textarea of `invoiceId, amount` lines into detect-request lines. */
function parseLines(
  raw: string,
): { invoiceId: string; insurerStatementAmount: string }[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [invoiceId, amount] = l.split(/[,\t]/).map((p) => p.trim());
      return { invoiceId: invoiceId ?? '', insurerStatementAmount: amount ?? '' };
    });
}

export default function BankReconciliationPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t, tPlural } = useLanguage();
  const canReconcile =
    !!user &&
    hasPermission(user, 'reconciliation-exception.investigate');

  const [rows, setRows] = useState<ReconciliationException[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statement, setStatement] = useState('');
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [resumes, setResumes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setRows(
        await listReconciliationExceptions().then((r) =>
          r.filter((e) => !e.isResolved),
        ),
      );
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'brRefusalAct', 'reconciliation-exception.investigate')
          : err instanceof ApiError
            ? err.message
            : t('brLoadError'),
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

  async function runDetect(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      setDetectResult(await detectReconciliation(parseLines(statement)));
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('brDetectError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('brActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('brHeading')}
        description={t('brIntro')}
      />

      {canReconcile ? (
        <form onSubmit={runDetect} style={{ margin: '1rem 0' }}>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
          >
            {/*
              The `<code>` span stays in JSX and the prose is split around it: markup inside a translated
              string becomes escaped text, and the Arabic word order around a code span is not the
              English one.
            */}
            {t('brStatementLinesHintBefore')}{' '}
            <code>invoiceId, amount</code> {t('brStatementLinesHintAfter')}
            <textarea
              aria-label={t('brStatementLinesLabel')}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={5}
              style={{ fontFamily: 'monospace', minWidth: '28rem' }}
              placeholder={'11111111-1111-1111-1111-111111111111, 105600.000'}
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.5rem' }}>
            {busy ? t('brRunningButton') : t('brRunButton')}
          </button>
        </form>
      ) : null}
      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {detectResult ? (
        <p>
          {tPlural('brDetectLines', detectResult.lineCount)}:{' '}
          {t('brDetectReconciled', { count: detectResult.reconciled })},{' '}
          <strong>
            {tPlural('brDetectExceptions', detectResult.exceptionsRaised)}
          </strong>
          .
        </p>
      ) : null}

      <h2>{t('brOpenExceptions')}</h2>
      {rows ? (
        rows.length === 0 ? (
          <EmptyState title={t('brNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('brColInvoice')}</Th>
                  <Th numeric>
                    {t('brColStatement')}
                  </Th>
                  <Th numeric>{t('brColBroker')}</Th>
                  <Th numeric>
                    {t('brColVariance')}
                  </Th>
                  <Th>{t('brColStatus')}</Th>
                  <Th>{t('brColAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>{r.invoiceId ?? '—'}</Td>
                    <Td numeric>
                      {r.insurerStatementAmount}
                    </Td>
                    <Td numeric>
                      {r.brokerRecordAmount}
                    </Td>
                    <Td numeric>
                      <strong>{r.varianceAmount}</strong>
                    </Td>
                    <Td>{t(ENUM_LABEL.ReconciliationExceptionStatus[r.status])}</Td>
                    <Td>
                      {canReconcile ? (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.35rem',
                          }}
                        >
                          {r.status === 'open' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  investigateReconciliationException(r.id),
                                )
                              }
                            >
                              {t('brInvestigateButton')}
                            </button>
                          ) : null}
                          <input
                            aria-label={t('brResolutionNoteRowAria')}
                            placeholder={t('brResolutionNoteAria')}
                            value={notes[r.id] ?? ''}
                            onChange={(e) =>
                              setNotes((n) => ({ ...n, [r.id]: e.target.value }))
                            }
                          />
                          <select
                            aria-label={t('brResumeInvoiceRowAria')}
                            value={resumes[r.id] ?? ''}
                            onChange={(e) =>
                              setResumes((s) => ({
                                ...s,
                                [r.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">{t('brResumeInvoiceAs')}</option>
                            <option value="RECONCILED">{t('brResumeReconciled')}</option>
                          </select>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                resolveReconciliationException(r.id, {
                                  resolutionNote: (notes[r.id] ?? '').trim(),
                                  ...(resumes[r.id]
                                    ? { resumeInvoiceAs: resumes[r.id] }
                                    : {}),
                                }),
                              )
                            }
                          >
                            {t('brResolveButton')}
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
        <SkeletonList rows={4} label={t('brLoading')} />
      )}
    </main>
  );
}
