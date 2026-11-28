"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createInvoice,
  downloadInvoiceDocument,
  listInvoicesForPolicy,
  type Invoice,
} from "../../lib/finance/invoice-api";
import {
  listPoliciesForOpportunity,
  type Policy,
} from "../../lib/policy/policy-api";
import { ApiError } from "../../lib/auth/api-client";
import { buttonStyle, errorStyle } from "../auth/auth-form.styles";
import {
  quoteChainCardStyle,
  quoteFieldStyle,
} from "../quotation/quotation.styles";
import { useLanguage } from "../../lib/i18n/language-context";
import { InvoiceCollectionControls } from '../finance/InvoiceCollectionControls';
import { formatDate, formatMoney } from "../../lib/i18n/format";
import { INVOICE_STATUS_LABEL_KEY } from '../../lib/finance/invoice-status';

interface Props {
  opportunityId: string;
  /** Finance — raise the premium invoice. */
  canInvoice: boolean;
  /** Finance — drive the collection cycle (receipt / reconcile / remittance). */
  canCollect: boolean;
  /**
   * 🔴 `remittance.record` — ADDED with decision 167/13, and it closes a dead control.
   *
   * `canCollect` is `receipt.record`, and the remit route requires a DIFFERENT code. This screen
   * gated all three controls on the one boolean, so a holder of `receipt.record` alone was shown a
   * remit button that could only 403 — the dead control `frontend-ux-directive.md` rules out.
   */
  canRemit: boolean;
}

/** The section only makes sense once a policy exists with an issued premium —
 * #31 bills `Policy.issuedPremium`. */
export function FinanceSection({
  opportunityId,
  canInvoice,
  canCollect,
  canRemit,
}: Props) {
  const { language, t } = useLanguage();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [taxAmount, setTaxAmount] = useState("0.000");
  const [feesAmount, setFeesAmount] = useState("0.000");
  const [dueDate, setDueDate] = useState("");
  /*
   * ROW 21 — REQUIRED. Owner decision, 2026-11-07.
   *
   * This comment used to read: *"Blank means 'the whole outstanding balance', which is the common
   * case and keeps the one-click full-payment flow intact."* That behaviour is GONE, and a comment
   * describing behaviour that no longer exists is the exact defect class this module exists for, so
   * it is replaced rather than left.
   *
   * The old behaviour was deliberate and commented and **never stated on screen** — the placeholder
   * was the only hint. Her reasoning for closing it: recording a payment that was not received is a
   * money error, and the convenience being given up is one field being typed.
   *
   * NO NEW STRING IN EITHER LANGUAGE. The refusal is this component's own existing pattern — the
   * record button is already `disabled` while `paymentReference` is blank, and the amount simply
   * joins that condition. `required` + `aria-required` are added for the accessible semantics, and
   * are NOT the enforcement: measured 2026-11-07, there is no `<form>` anywhere in this component
   * and every button is `type="button"`, so native validation never fires. That is also true of
   * `paymentReference`'s own `required`, which has always been decorative here — the server is what
   * enforces it. Reported rather than fixed, because making these a real form is a change to five
   * controls and not to one.
   */

  const load = useCallback(async () => {
    setError(null);
    try {
      const policies = await listPoliciesForOpportunity(opportunityId);
      const p = policies[0] ?? null;
      setPolicy(p);
      setInvoices(p ? await listInvoicesForPolicy(p.id) : []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // A non-finance viewer simply doesn't see billing — not an error.
        setPolicy(null);
        setInvoices([]);
        return;
      }
      setError(err instanceof Error ? err.message : t("financeLoadError"));
    }
  }, [opportunityId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  if (!policy || policy.issuedPremium === null) return null;

  const invoice = invoices[0] ?? null;

  // Part F item #7 — the customer's own languagePreference decides the
  // document's language server-side; no picker here for a first pass. The
  // button is only rendered once an invoice exists (see below).
  async function downloadDocument(id: string) {
    setError(null);
    try {
      const blob = await downloadInvoiceDocument(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t('polFinInvoiceError'),
      );
    }
  }

  async function runStep(step: () => Promise<unknown>, failMsg: string) {
    setBusy(true);
    setError(null);
    try {
      await step();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : failMsg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>
        {t("financeSectionHeading")}
      </h2>

      {error ? <p style={errorStyle}>{error}</p> : null}

      {invoice ? (
        <div style={quoteChainCardStyle}>
          <div style={quoteFieldStyle}>
            <span>{t("financePremiumLabel")}</span>
            <strong>
              {formatMoney(invoice.premiumAmount, language, invoice.currency)}
            </strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>{t("financeTaxLabel")}</span>
            <strong>
              {formatMoney(invoice.taxAmount, language, invoice.currency)}
            </strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>{t("financeFeesLabel")}</span>
            <strong>
              {formatMoney(invoice.feesAmount, language, invoice.currency)}
            </strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>{t("financeCommissionDeductedLabel")}</span>
            <strong>
              −
              {formatMoney(
                invoice.commissionDeducted,
                language,
                invoice.currency,
              )}
            </strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>{t("financeTotalLabel")}</span>
            <strong>
              {formatMoney(invoice.totalAmount, language, invoice.currency)}
            </strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>{t("financeDueDateLabel")}</span>
            <strong>{formatDate(invoice.dueDate, language)}</strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>{t("financeStatusLabel")}</span>
            {/* The status label and the "Collected" AMOUNT field both read
                "Collected" in English, so the status carries a testid: a bare
                getByText would match two elements. The raw enum token used to
                be unique by accident, which is what made the old assertions
                look unambiguous. */}
            <strong data-testid="invoice-status">
              {t(INVOICE_STATUS_LABEL_KEY[invoice.status])}
            </strong>
          </div>
          {(invoice.receipts?.length ?? 0) > 0 ? (
            <>
              <div style={quoteFieldStyle}>
                <span>{t("financeCollectedLabel")}</span>
                <strong>
                  {formatMoney(
                    invoice.collectedAmount,
                    language,
                    invoice.currency,
                  )}
                </strong>
              </div>
              {!invoice.fullyCollected ? (
                <div style={quoteFieldStyle}>
                  <span>{t("financeOutstandingLabel")}</span>
                  <strong>
                    {formatMoney(
                      invoice.outstandingAmount,
                      language,
                      invoice.currency,
                    )}
                  </strong>
                </div>
              ) : null}
              {(invoice.receipts?.length ?? 0) > 1 ? (
                <div style={quoteFieldStyle}>
                  <span>{t("financeInstalmentsLabel")}</span>
                  <strong>
                    {(invoice.receipts ?? [])
                      .map(
                        (r) =>
                          `${formatMoney(r.amount, language, invoice.currency)} · ${formatDate(r.receivedAt, language)}`,
                      )
                      .join(" | ")}
                  </strong>
                </div>
              ) : null}
            </>
          ) : null}
          {invoice.remittance ? (
            <div style={quoteFieldStyle}>
              <span>{t("financeRemittedLabel")}</span>
              <strong>
                {formatMoney(
                  invoice.remittance.amount,
                  language,
                  invoice.currency,
                )}
                {invoice.remittance.remittedAt
                  ? ` on ${formatDate(invoice.remittance.remittedAt, language)}`
                  : ""}
              </strong>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void downloadDocument(invoice.id)}
            style={{ ...buttonStyle, width: "auto", marginTop: "0.4rem" }}
          >
            {t('policyDownloadInvoiceButton')}
          </button>
        </div>
      ) : (
        <p style={{ color: "var(--ink-muted)" }}>
          {t("financeNoInvoiceMessage", {
            amount: formatMoney(
              policy.issuedPremium,
              language,
              policy.currency,
            ),
          })}
        </p>
      )}

      {!invoice && canInvoice ? (
        <div
          style={{
            display: "grid",
            gap: "0.5rem",
            maxWidth: "22rem",
            marginTop: "0.75rem",
          }}
        >
          <label>
            {t("financeTaxAmountLabel")}
            <input
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
              inputMode="decimal"
              style={{ width: "100%" }}
            />
          </label>
          <label>
            {t("financeFeesAmountLabel")}
            <input
              value={feesAmount}
              onChange={(e) => setFeesAmount(e.target.value)}
              inputMode="decimal"
              style={{ width: "100%" }}
            />
          </label>
          <label>
            {t("financeDueDateLabel")}
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              void runStep(
                () =>
                  /*
                   * ROW 73 — fixed 2026-11-06 (module 0-c batch 6). THE TWO FIELDS ARE NOT THE SAME
                   * AND THIS TREATED THEM AS THE SAME.
                   *
                   * `CreateInvoiceDto` declares `taxAmount!: string` with NO `@IsOptional`, and
                   * `feesAmount?: string` WITH it and a documented default of 0. So the server
                   * draws a real distinction: fees may be omitted, the premium tax must be
                   * supplied, because no governed tax-rate table exists and Finance is the one who
                   * decides the figure.
                   *
                   * Both arrived here as `x.trim() || "0"`, which erased that distinction: a
                   * cleared tax field was silently refilled with zero before the request left the
                   * browser, so the server's requirement could never fail and existed only on
                   * paper. The `"0.000"` the field STARTS with is not the defect and stays — a
                   * visible default a person can read and change is a decision offered, where a
                   * silent substitution is a decision taken on their behalf.
                   *
                   * `feesAmount` keeps its `|| "0"`, because there the substitution matches what
                   * the server itself documents.
                   */
                  createInvoice({
                    policyId: policy.id,
                    taxAmount: taxAmount.trim(),
                    feesAmount: feesAmount.trim() || "0",
                    dueDate,
                  }),
                t("financeCreateError"),
              )
            }
            disabled={busy || dueDate.trim().length === 0}
            style={buttonStyle}
          >
            {t("financeIssueInvoiceButton")}
          </button>
        </div>
      ) : null}

      {/*
        🔴 THE THREE COLLECTION CONTROLS MOVED TO `InvoiceCollectionControls` — DECISION 167/13.
        «ريوز النماذج»: the owner's condition is that the finance invoice screen reuses the forms
        and strings this component already shipped, as a SHARED component, so the two screens cannot
        drift. This is the other call site.

        ⛔ NOT ONE WORD CHANGED HERE. The three label keys are passed in, so this screen keeps
        «تسجيل تحصيل», «تسوية الأموال المستلمة» and «تحويل {amount} إلى المؤمِّن» — including the
        AMOUNT on the remit button, which decision 167/13's plain «تسجيل توريد» does not carry and
        which she did not ask to remove from a control that moves money.

        🔴 AND THE REMIT CONTROL IS GATED ON ITS OWN CODE NOW. It read `canCollect`, which this
        screen's parent computes from `receipt.record` — while the route requires
        `remittance.record`. A holder of one and not the other saw a button that could only 403.
        Measured 2026-11-28: the demo seed's FINANCE role holds both, so it never bit there; a real
        new office holds neither until it grants them (decision 131), so a custom role reaches it.
        `canRemit` is threaded from the page beside `canCollect`.
      */}
      {invoice ? (
        <InvoiceCollectionControls
          invoice={invoice}
          canRecordReceipt={canCollect}
          canRecordRemittance={canRemit}
          onDone={load}
          busy={busy}
          run={runStep}
          receiptLabelKey="financeRecordCollectionButton"
          reconcileLabelKey="financeReconcileButton"
          remitLabelKey="financeRemitButton"
        />
      ) : null}
    </section>
  );
}
