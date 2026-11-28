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
import { formatMoney } from '../../../lib/i18n/format';
import { EntitySearch } from '../../../components/ui/EntitySearch';
import {
  listInvoices,
  type InvoiceListRow,
} from '../../../lib/finance/invoice-api';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';



/*
 * 🔴 THE TEXTAREA PARSE IS GONE — DECISION 167/13 / MESSAGE B §1 ITEM 2.
 *
 * It read a textarea of `invoiceId, amount` lines, split each on a comma or a tab, and substituted
 * `''` for a missing half — so a malformed line was refused SERVER-side by `@IsUUID()` rather than
 * locally. And its placeholder was a literal uuid
 * (`11111111-1111-1111-1111-111111111111, 105600.000`): the screen asked a finance officer to paste
 * invoice uuids they had no way to obtain.
 *
 * ⟶ The insurer is PICKED, its open invoices are LISTED, and each row takes the amount on the
 *   insurer's statement. No separator is parsed at all, so no separator can be got wrong — which
 *   is the same reason §3's lists are entered one per row rather than split on a comma.
 */

export default function BankReconciliationPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  /* `language` ADDED — decision 167/13: the open-invoice table formats money through
   * `formatMoney`, which renders in the reader's locale. */
  const { t, tPlural, language } = useLanguage();
  const canReconcile =
    !!user &&
    hasPermission(user, 'reconciliation-exception.investigate');

  const [rows, setRows] = useState<ReconciliationException[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /* DECISION 167/13 — the picked insurer, its open invoices, and the amount typed against each.
   * Keyed by invoice id so a row's figure cannot be attributed to its neighbour; the id is a KEY
   * here and is never rendered. */
  const [insurerId, setInsurerId] = useState<string | null>(null);
  const [openInvoices, setOpenInvoices] = useState<InvoiceListRow[] | null>(
    null,
  );
  const [amounts, setAmounts] = useState<Record<string, string>>({});
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

  /**
   * 🔴 THE PICKED INSURER'S OPEN INVOICES — decision 167/13.
   *
   * Its OWN effect rather than folded into `load()`: that read is gated on
   * `reconciliation-exception.investigate` and this one on `client-accounting.read`, so a reader
   * holding the first and not the second must still get the exception table. Folded in, one 403
   * would close the whole screen — the failure `/settings/org-units` already solved by rendering
   * the half the reader holds, and the same split `/customers/[id]`'s KYC read uses.
   */
  useEffect(() => {
    /*
     * ⚠️ NO SYNCHRONOUS `setState` HERE — `react-hooks/set-state-in-effect` refused the first
     * version, which cleared the list in the effect body when no insurer was picked. It was right:
     * that is a cascading render for a value the render can simply compute.
     *
     * ⟶ `openInvoices` is only ever READ inside the `insurerId !== null` branch of the render, so
     *   «no insurer picked» needs no state change at all — the stale list is unreachable. What the
     *   effect does is set it when a read COMPLETES, which is the callback shape the rule asks for.
     */
    if (!user || insurerId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await listInvoices({ insurerId });
        if (!cancelled) setOpenInvoices(page.items);
      } catch {
        /* Deliberately silent, and the empty state says it: the exception table below is the
           reason this screen exists, and an error banner for the picker's list would report the
           screen as unloadable when it loaded. */
        if (!cancelled) setOpenInvoices([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, insurerId]);

  /**
   * The rows the officer actually filled, in the detect request's own shape.
   *
   * ⛔ A BLANK IS «NOT ON THIS STATEMENT», NEVER «ZERO». Sending zero for an untouched row would
   * raise a variance for that invoice's whole amount — and `/bank-reconciliation`'s own intro says
   * every non-zero difference opens an exception that is never written off. So a blank row is not
   * submitted at all, and the button is disabled while none is filled.
   */
  function filledLines(): {
    invoiceId: string;
    insurerStatementAmount: string;
  }[] {
    return Object.entries(amounts)
      .filter(([, amount]) => amount.trim().length > 0)
      .map(([invoiceId, amount]) => ({
        invoiceId,
        insurerStatementAmount: amount.trim(),
      }));
  }

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
      setDetectResult(await detectReconciliation(filledLines()));
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
          {/*
            THE INSURER, PICKED. `EntitySearch`'s insurer kind reads `GET /insurers/search`, which
            is gated on an ANY-OF including `dashboard.financial.view` — measured 2026-11-28: the
            FINANCE role holds that, so the one role that holds
            `reconciliation-exception.investigate` reaches this picker with ⛔ no widening and no
            code granted.
          */}
          <EntitySearch
            kind="insurer"
            /* «شركة التأمين» — `invColInsurer`, which this batch sliced from `iaColInsurer`. */
            label={t('invColInsurer')}
            value={insurerId ?? ''}
            onChange={(id) => {
              setInsurerId(id === '' ? null : id);
              // The amounts belong to the PREVIOUS insurer's invoices. Keeping them would submit
              // one insurer's statement figures against another's rows.
              setAmounts({});
            }}
          />

          {insurerId === null ? null : openInvoices === null ? (
            <SkeletonList rows={3} label={t('commonLoading')} />
          ) : openInvoices.length === 0 ? (
            <EmptyState title={t('smNoRecords')} />
          ) : (
            <Card padded={false}>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('invColPolicy')}</Th>
                    <Th>{t('invColCustomer')}</Th>
                    <Th numeric>{t('invColTotal')}</Th>
                    <Th numeric>{t('brColStatement')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((invoice) => (
                    <Tr key={invoice.id}>
                      {/* ⛔ NO INVOICE ID, TYPED OR SHOWN — the whole of this item. The row is
                          identified by what is on the paper in the officer's hand. */}
                      <Td>
                        <bdi data-recon-policy={invoice.id}>
                          {invoice.policyNumber ?? '—'}
                        </bdi>
                      </Td>
                      <Td>
                        <bdi>{invoice.customerLegalName}</bdi>
                      </Td>
                      <Td numeric>
                        {formatMoney(
                          invoice.totalAmount,
                          language,
                          invoice.currency,
                        )}
                      </Td>
                      <Td numeric>
                        <input
                          value={amounts[invoice.id] ?? ''}
                          onChange={(e) =>
                            setAmounts((prev) => ({
                              ...prev,
                              [invoice.id]: e.target.value,
                            }))
                          }
                          inputMode="decimal"
                          data-recon-amount={invoice.id}
                          aria-label={t('brColStatement')}
                        />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          {/* ONLY THE ROWS THAT WERE FILLED are submitted — a blank is «not on this statement»,
              not «zero», and sending zero would raise a variance for the whole invoice. */}
          <button
            type="submit"
            disabled={busy || filledLines().length === 0}
            style={{ marginTop: '0.5rem' }}
          >
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
                  {/* The column names the POLICY, because that is what the cell now carries.
                      `brColInvoice` is left in the dictionary unread — its Arabic is hers. */}
                  <Th>{t('invColPolicy')}</Th>
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
                    {/*
                      🔴 THE WALK'S OWN FINDING — this printed `r.invoiceId`, a bare uuid, unlinked
                      and with nothing beside it. Nothing in the product resolves one for a reader.

                      ⟶ It names the POLICY now, looked up among the invoices already on this
                        screen. ⚠️ And where it is not among them — an exception on another insurer's
                        invoice, or one raised before this insurer was picked — it is an ABSENCE
                        rather than the uuid: a reader who cannot act on an id is not helped by
                        seeing it, and the row's variance and status still say what happened.
                    */}
                    <Td>
                      <bdi data-exception-policy={r.id}>
                        {(r.invoiceId === null
                          ? null
                          : (openInvoices ?? []).find(
                              (i) => i.id === r.invoiceId,
                            )?.policyNumber) ?? '—'}
                      </bdi>
                    </Td>
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
