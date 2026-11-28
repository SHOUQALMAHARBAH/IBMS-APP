'use client';

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
// Its own path, as `/claims`, `/customers` and `/audit-trail` all import it — it is not re-exported
// from the barrel.
import { Pagination } from '../../../components/ui/Pagination';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { hasPermission } from '../../../lib/auth/permissions';
import { ApiError } from '../../../lib/auth/api-client';
import {
  listInvoices,
  type InvoiceListRow,
} from '../../../lib/finance/invoice-api';
import { INVOICE_STATUS_LABEL_KEY } from '../../../lib/finance/invoice-status';
import { InvoiceCollectionControls } from '../../../components/finance/InvoiceCollectionControls';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDate, formatMoney } from '../../../lib/i18n/format';
import { insurerDisplayName } from '../../../lib/i18n/names';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

/**
 * 🔴 THE FINANCE INVOICE SCREEN — DECISION 167/13.
 *
 * ## The defect it closes
 *
 * Ahmad works in finance. A customer paid JOD 1,100 for a policy and he has to record the receipt,
 * then later the remittance to the insurer. Until this screen the ONLY place to do either was the
 * finance block inside `/opportunities/[id]` — and finance is refused there, because that page
 * needs `opportunity.read` which no finance role holds. So he could not do his main job.
 *
 * ⛔ AND FINANCE IS NOT GIVEN AN OPPORTUNITY PERMISSION. The standing rule is that no role is
 * granted a code to make a screen work; the opportunity page stays closed to them, and
 * `invoices.spec.ts` asserts that it still is, naming WHICH refusal.
 *
 * ## ⛔ No uuid is typed and none is shown
 *
 * That is the whole of decision 167/13 and of message B. Every row names its customer, its policy
 * and its insurer — resolved on the SERVER, because `GET /insurance-lines`-style catalogue reads
 * are gated on codes finance does not hold and the names therefore travel with the record.
 * Measured over the dev database before this screen was written
 * (`scripts/measurements/invoice-list-page.ts`): 46 of 46 rows named all three, and ZERO display
 * values were a uuid.
 *
 * ## The two acts are each gated on their OWN code
 *
 * `receipt.record` for the receipt and the reconcile step; `remittance.record` for the remittance.
 * ⛔ Not one boolean for all three, which is the dead control this batch found on the other screen:
 * it gated remit on `receipt.record` while the route requires `remittance.record`.
 *
 * ## The list is `client-accounting.read`, which is what the ROUTE enforces
 *
 * ⛔ Not widened to match the nav entry — the ROW 30 rule in `destinations.ts`: a link whose only
 * function is to tell somebody no is worse than no link.
 *
 * Measured 2026-11-28 — `client-accounting.read` in the DEMO SEED: FINANCE_COLLECTIONS_OFFICER,
 * BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR. In a REAL NEW OFFICE: nobody,
 * because its administrator's 47 grants carry no finance code at all and the office grants them
 * itself (decision 131). ⟶ So this screen is built for a set that is empty on day one, which is
 * correct and is reported rather than worked around.
 */
export default function InvoicesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t, language } = useLanguage();

  const [page, setPage] = useState<{
    items: InvoiceListRow[];
    total: number;
    page: number;
    pageSize: number;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);

  const canRead = !!user && hasPermission(user, 'client-accounting.read');
  const canRecordReceipt = !!user && hasPermission(user, 'receipt.record');
  const canRecordRemittance =
    !!user && hasPermission(user, 'remittance.record');

  const load = useCallback(async () => {
    try {
      setPage(await listInvoices({ search: search || undefined, page: pageIndex }));
      setLoadError(null);
    } catch (err) {
      setPage(null);
      setLoadError(
        err instanceof ApiError ? err.message : t('commonTryAgain'),
      );
    }
  }, [search, pageIndex, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user || !canRead) return;
    /*
     * ⚠️ THE ASYNC IIFE IS NOT DECORATION — `react-hooks/set-state-in-effect` refused
     * `void load()` here, and CI's whole-workspace lint is where it surfaced because I had linted
     * only the files I changed. `load` calls `setPage`, so a direct call makes that a SYNCHRONOUS
     * setState in an effect body; inside the IIFE it is a callback, which is the shape the rule
     * asks for and the shape every sibling screen already uses (`/bank-reconciliation`,
     * `/client-accounting`, `/customers/[id]`).
     */
    void (async () => {
      await load();
    })();
  }, [user, canRead, load]);

  /** The caller-owned runner the shared controls take. Mirrors `FinanceSection.runStep` so the two
   *  screens behave identically on a failure, and re-reads so the row shows what changed. */
  async function run(step: () => Promise<unknown>, failMsg: string) {
    setBusy(true);
    setActionError(null);
    try {
      await step();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : failMsg);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  /*
   * 🔴 THE REFUSAL USES THE CODE'S OWN ACT PHRASE, AND THE PHRASE NAMES THE SIBLING SCREEN.
   *
   * ⚠️ `check:four-states` REFUSED THE FIRST VERSION OF THIS SCREEN, which had no client-side
   * refusal at all: «no permission refusal 10 against a budget of 9 … a screen that refuses
   * without saying so sends somebody to ask for the wrong grant», and that budget only falls. It
   * was right, and it is why this is here rather than reported as an empty cell.
   *
   * ⛔ BUT «عرض الفواتير» IS NOT SHIPPED AND IS NOT COMPOSED HERE. It would be «عرض» (four
   * shipping keys) joined to «الفواتير» — the composition decision 125 forbids, which `/employees`
   * reported as an empty cell and which the owner later ratified ONCE, as «عرض الفرص» (decision
   * 152 §١). Ratifying one composition is not ratifying the pattern. Measured: all 110
   * `*RefusalAct` keys are screen-specific and not one of them mentions an invoice.
   *
   * ⟶ So it takes `caRefusalAct`, the act phrase of the very code this screen is gated on
   *   (`client-accounting.read`), SLICED rather than written. ⚠️ AND IT NAMES THE SIBLING SCREEN —
   *   «عرض تقرير حسابات العملاء», the ageing report — which is the one thing wrong with it and is
   *   REPORTED rather than papered over. What the reader actually needs is in the sentence's other
   *   half: `({name})` carries the permission's own ratified Arabic name, which is what they ask
   *   their administrator for.
   *
   *   ⚠️ And that name, «يرى ما لم يُقبَض من العملاء وأعماره», itself describes the ageing report —
   *   so the code she named for one surface now has two. Hers to settle; ⛔ neither the code nor
   *   the name is changed here.
   */
  if (!canRead) {
    return (
      <main style={pageStackStyle}>
        <p role="alert">
          {permissionRefusal(t, 'caRefusalAct', 'client-accounting.read')}
        </p>
      </main>
    );
  }

  /*
   * ⚠⚠ AND THE SCREEN'S OWN ACT PHRASE IS STILL AN EMPTY ARABIC CELL.
   *
   * `permissionRefusal` interpolates an ACT into «ليست لديك صلاحية {act}», and the act here would
   * be «عرض الفواتير» — «عرض» (four shipping keys) joined to «الفواتير» (three). ⛔ That is
   * making a third word out of two shipped ones, which decision 125 forbids: `/employees` kept the
   * bare «عرض» and reported «فتح الفرص» as an empty cell for exactly this reason, and the owner
   * then RATIFIED «عرض الفرص» herself in decision 152 §١. Ratifying one composition is not
   * ratifying the pattern, and all 110 `*RefusalAct` keys are screen-specific — there is no generic
   * one to borrow.
   *
   * ⛔ AND THE NEAREST SHIPPING ACT IS FALSE HERE: `caRefusalAct` is «عرض تقرير حسابات العملاء»,
   * which names the AGEING REPORT — a different screen on the same permission.
   *
   * ⟶ So what stands in for it is the two gates that need no new word: the nav entry carries
   *   `client-accounting.read`, so a reader without it never sees the link (`destinations.ts`);
   *   and a direct URL visit gets the SERVER's own 403 surfaced through `loadError` below. That is
   *   §C's raw-English problem, which this message explicitly excludes — named here so the next
   *   session finds it rather than rediscovering it.
   */
  return (
    <main style={pageStackStyle}>
      {/*
        ⚠️ NO DESCRIPTION, AND THAT IS AN EMPTY ARABIC CELL rather than an omission.
        `PageHeader`'s `description` is optional, and every sibling finance screen has a ruled
        intro paragraph (`caIntro`, `iaIntro`, `brIntro`). Decision 167/13 gives the TITLE
        («الفواتير») and the two buttons and no intro, and composing one out of other screens'
        sentences is what decision 125 forbids. ⟶ Reported; hers to give in one line.
      */}
      <PageHeader title={t('invHeading')} />

      <div>
        <label htmlFor="inv-search">{t('commonSearch')}</label>
        <input
          id="inv-search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            // Back to the first page: a filter that kept the page index would show page 4 of a
            // one-page result and read as an empty screen.
            setPageIndex(0);
          }}
          placeholder={t('commonSearchPlaceholder')}
        />
      </div>

      {loadError ? <ErrorState title={loadError} /> : null}
      {actionError ? <ErrorState title={actionError} /> : null}

      {page === null && loadError === null ? (
        <SkeletonList rows={4} label={t('commonLoading')} />
      ) : null}

      {page !== null && page.items.length === 0 ? (
        <EmptyState title={t('smNoRecords')} />
      ) : null}

      {page !== null && page.items.length > 0 ? (
        <>
          <Table>
            <thead>
              <Tr>
                <Th>{t('invColCustomer')}</Th>
                <Th>{t('invColPolicy')}</Th>
                <Th>{t('invColInsurer')}</Th>
                <Th numeric>{t('invColTotal')}</Th>
                <Th numeric>{t('invColCollected')}</Th>
                <Th numeric>{t('invColRemitted')}</Th>
                <Th>{t('invColDue')}</Th>
                <Th>{t('invColStatus')}</Th>
              </Tr>
            </thead>
            <tbody>
              {page.items.map((invoice) => (
                <Tr key={invoice.id}>
                  <Td>
                    {/* `<bdi>` because a Latin company name inside an Arabic table is exactly the
                        bidi case that reorders without it. */}
                    <bdi data-invoice-customer={invoice.id}>
                      {invoice.customerLegalName}
                    </bdi>
                  </Td>
                  {/* ⛔ AN ABSENCE, NEVER THE UUID. A policy has no number until the insurer issues
                      one, and an invoice may carry no policy at all. */}
                  <Td>
                    <bdi data-invoice-policy={invoice.id}>
                      {invoice.policyNumber ?? '—'}
                    </bdi>
                  </Td>
                  <Td>
                    <bdi data-invoice-insurer={invoice.id}>
                      {invoice.insurerName === null
                        ? '—'
                        : insurerDisplayName(
                            {
                              name: invoice.insurerName,
                              nameAr: invoice.insurerNameAr,
                            },
                            language,
                          )}
                    </bdi>
                  </Td>
                  <Td numeric>
                    {formatMoney(invoice.totalAmount, language, invoice.currency)}
                  </Td>
                  <Td numeric>
                    {formatMoney(
                      invoice.collectedAmount,
                      language,
                      invoice.currency,
                    )}
                  </Td>
                  <Td numeric>
                    {invoice.remittance === null
                      ? '—'
                      : formatMoney(
                          invoice.remittance.amount,
                          language,
                          invoice.currency,
                        )}
                  </Td>
                  <Td>{formatDate(invoice.dueDate, language)}</Td>
                  <Td>
                    <span data-invoice-status={invoice.id}>
                      {t(INVOICE_STATUS_LABEL_KEY[invoice.status])}
                    </span>
                    {/*
                      THE TWO ACTS, on the invoice they belong to. The shared component decides
                      which of the three controls the invoice's STATUS permits, which is what
                      `CollectionService` accepts — so no control here can be pressed into a 422.

                      ⛔ Her words on THIS screen: «تسجيل قبض» and «تسجيل توريد», byte-exact from
                      decision 167/13. `FinanceSection` keeps its own, including the amount on its
                      remit button — see the component's header for why they are not unified.
                    */}
                    <InvoiceCollectionControls
                      invoice={invoice}
                      canRecordReceipt={canRecordReceipt}
                      canRecordRemittance={canRecordRemittance}
                      onDone={load}
                      busy={busy}
                      run={run}
                      receiptLabelKey="invRecordReceiptButton"
                      reconcileLabelKey="financeReconcileButton"
                      remitLabelKey="invRecordRemittanceButton"
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={page.page}
            pageSize={page.pageSize}
            total={page.total}
            onPageChange={setPageIndex}
          />
        </>
      ) : null}
    </main>
  );
}
