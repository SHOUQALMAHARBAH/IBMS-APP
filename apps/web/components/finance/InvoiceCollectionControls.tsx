'use client';

import { useState } from 'react';
import {
  recordReceipt,
  recordRemittance,
  reconcileInvoice,
  RECEIPT_METHOD_OPTIONS,
  type Invoice,
} from '../../lib/finance/invoice-api';
import { RECEIPT_METHOD_LABEL_KEY } from '../../lib/finance/invoice-status';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';
import { formatMoney } from '../../lib/i18n/format';
import { buttonStyle } from '../auth/auth-form.styles';

/**
 * 🔴 THE COLLECTION CYCLE'S THREE CONTROLS, IN ONE PLACE — DECISION 167/13.
 *
 * ## Why this file exists
 *
 * Ahmad works in finance. A customer paid JOD 1,100 and he has to record the receipt, then later
 * the remittance to the insurer. Until now the only place to do either was `FinanceSection` inside
 * `/opportunities/[id]` — a screen finance is refused on, because it needs `opportunity.read`
 * which no finance role holds. So he could not do his main job.
 *
 * Decision 167/13 puts those acts on a finance screen of their own. ⛔ And NOT by giving finance an
 * opportunity permission: the standing rule is that no role is granted a code to make a screen
 * work, and the opportunity page stays closed to them.
 *
 * ⟶ So the controls move HERE and both screens render this one component, which is the owner's own
 *   condition — «reuse the forms and strings `FinanceSection.tsx` already ships, as a shared
 *   component, so the two screens cannot drift».
 *
 * ## ⛔ NOT ONE WORD AND NOT ONE RULE CHANGED IN THE MOVE
 *
 * Every string is the key `FinanceSection` already used, every `disabled` condition is the one it
 * already had, and the reference is still mandatory for the reason its own comment gives: it is the
 * idempotency key, and without it a double-click books the client's payment twice.
 *
 * ## 🔴 ONE THING IS FIXED IN THE MOVE, AND IT WAS A DEAD CONTROL
 *
 * `FinanceSection` gated all three on a single `canCollect` boolean, which its parent computes from
 * `receipt.record`. But `POST /invoices/:id/remittance` requires **`remittance.record`** — a
 * different code. So a holder of `receipt.record` alone saw a remit button that could only 403.
 *
 * Measured 2026-11-28: in the demo seed `FINANCE_COLLECTIONS_OFFICER` holds BOTH, so it never bit
 * there — and a real new office holds NEITHER until it grants them (decision 131), so a custom role
 * with one and not the other is reachable the day an office defines one.
 *
 * ⟶ The two codes are therefore SEPARATE props, which is decision 167/13's own words («show each
 *   action only to holders of its own code») and the UX directive's rule that a control a role
 *   cannot use does not exist on their screen.
 *
 * ## The status fork is the server's, not a preference
 *
 * `INVOICED` → a receipt · `COLLECTED` → reconcile · `RECONCILED` → remit. Each matches what
 * `CollectionService` accepts at that status and 422s outside it, so no control here can be pressed
 * into a refusal.
 */
export function InvoiceCollectionControls({
  invoice,
  canRecordReceipt,
  canRecordRemittance,
  onDone,
  busy,
  run,
  receiptLabelKey,
  reconcileLabelKey,
  remitLabelKey,
}: {
  invoice: Invoice;
  /** `receipt.record` — the receipt AND the reconcile step, which share that code on the route. */
  canRecordReceipt: boolean;
  /** `remittance.record`. ⛔ A separate prop, never `canRecordReceipt`: see the header. */
  canRecordRemittance: boolean;
  /** Called after any of the three succeeds, so the caller can re-read. */
  onDone: () => void | Promise<void>;
  /** The caller owns the busy flag and the error surface, because the two screens place them
   *  differently — one inside a policy section, one in a table row. */
  busy: boolean;
  run: (step: () => Promise<unknown>, failMsg: string) => Promise<void>;
  /**
   * 🔴 THE THREE BUTTON LABELS ARE THE CALLER'S, AND THAT IS NOT A CONVENIENCE.
   *
   * Decision 167/13 gives the INVOICE SCREEN «تسجيل قبض» and «تسجيل توريد». It says nothing about
   * `FinanceSection`'s buttons, and those are not the same strings: the shipped remit button reads
   * «تحويل {amount} إلى المؤمِّن» — it carries the AMOUNT, which is real information on a control
   * that moves money.
   *
   * ⛔ SO HER WORD IS NOT APPLIED TO THE OTHER SCREEN, which would silently drop that amount from
   * a shipped button she did not ask to change. And ⛔ the two screens do not each invent a label
   * either: the keys are passed in and named at both call sites, so what is SHARED is the forms,
   * the validation and the permission split — which is what «so the two screens cannot drift» is
   * actually about.
   *
   * ⚠️ A label carrying `{amount}` gets it; one that does not ignores it, which is `translate`'s
   * own behaviour (it substitutes only the placeholders a resolved string contains). So one call
   * passes the amount and the other does not have to care.
   */
  receiptLabelKey: TranslationKey;
  reconcileLabelKey: TranslationKey;
  remitLabelKey: TranslationKey;
}) {
  const { t, language } = useLanguage();
  const [receiptMethod, setReceiptMethod] = useState<string>(
    RECEIPT_METHOD_OPTIONS[0],
  );
  const [instalmentAmount, setInstalmentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');

  return (
    <>
      {canRecordReceipt && invoice.status === 'INVOICED' ? (
        <div
          style={{
            display: 'grid',
            gap: '0.5rem',
            maxWidth: '22rem',
            marginTop: '0.75rem',
          }}
          data-collection-form={invoice.id}
        >
          <label>
            {t('financeReceivedViaLabel')}
            <select
              value={receiptMethod}
              onChange={(e) => setReceiptMethod(e.target.value)}
              style={{ width: '100%' }}
            >
              {RECEIPT_METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {t(RECEIPT_METHOD_LABEL_KEY[m])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('financeInstalmentAmountLabel')}
            <input
              value={instalmentAmount}
              onChange={(e) => setInstalmentAmount(e.target.value)}
              inputMode="decimal"
              required
              aria-required="true"
              /* The outstanding balance, which is INFORMATION rather than a default: with the field
                 required, a blank cannot be submitted, so showing the balance tells the officer
                 what is owed without offering to assume it. */
              placeholder={invoice.outstandingAmount}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            {t('financePaymentReferenceLabel')}
            <input
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              required
              aria-required="true"
              style={{ width: '100%' }}
            />
          </label>
          <button
            type="button"
            data-record-receipt={invoice.id}
            onClick={() =>
              void run(async () => {
                const result = await recordReceipt(invoice.id, {
                  // No fallback. A blank amount cannot reach the server, because the button is
                  // disabled until one is typed.
                  amount: instalmentAmount.trim(),
                  method: receiptMethod,
                  // Mandatory: it is the idempotency key. Without it a double-click books the
                  // client's payment twice.
                  reference: paymentReference.trim(),
                });
                setInstalmentAmount('');
                setPaymentReference('');
                await onDone();
                return result;
              }, t('financeCreateError'))
            }
            disabled={
              busy ||
              paymentReference.trim().length === 0 ||
              instalmentAmount.trim().length === 0
            }
            style={buttonStyle}
          >
            {t(receiptLabelKey)}
          </button>
        </div>
      ) : null}

      {canRecordReceipt && invoice.status === 'COLLECTED' ? (
        <button
          type="button"
          data-reconcile={invoice.id}
          onClick={() =>
            void run(async () => {
              const result = await reconcileInvoice(invoice.id);
              await onDone();
              return result;
            }, t('financeCreateError'))
          }
          disabled={busy}
          style={{ ...buttonStyle, marginTop: '0.75rem' }}
        >
          {t(reconcileLabelKey)}
        </button>
      ) : null}

      {/* ⛔ `canRecordRemittance`, NOT `canRecordReceipt` — the route requires `remittance.record`
          and `FinanceSection` gated this on the receipt code, so it was a button that could only
          403 for a holder of one and not the other. See the header. */}
      {canRecordRemittance && invoice.status === 'RECONCILED' ? (
        <button
          type="button"
          data-record-remittance={invoice.id}
          onClick={() =>
            void run(async () => {
              const result = await recordRemittance(invoice.id);
              await onDone();
              return result;
            }, t('financeCreateError'))
          }
          disabled={busy}
          style={{ ...buttonStyle, marginTop: '0.75rem' }}
        >
          {t(remitLabelKey, {
            amount: formatMoney(
              invoice.netRemittance,
              language,
              invoice.currency,
            ),
          })}
        </button>
      ) : null}
    </>
  );
}
