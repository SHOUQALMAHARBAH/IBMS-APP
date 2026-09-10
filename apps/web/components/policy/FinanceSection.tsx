"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createInvoice,
  downloadInvoiceDocument,
  listInvoicesForPolicy,
  recordReceipt,
  recordRemittance,
  reconcileInvoice,
  RECEIPT_METHOD_OPTIONS,
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
import { formatDate, formatMoney } from "../../lib/i18n/format";

interface Props {
  opportunityId: string;
  /** Finance — raise the premium invoice. */
  canInvoice: boolean;
  /** Finance — drive the collection cycle (receipt / reconcile / remittance). */
  canCollect: boolean;
}

/** The section only makes sense once a policy exists with an issued premium —
 * #31 bills `Policy.issuedPremium`. */
export function FinanceSection({
  opportunityId,
  canInvoice,
  canCollect,
}: Props) {
  const { language, t } = useLanguage();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [taxAmount, setTaxAmount] = useState("0.000");
  const [feesAmount, setFeesAmount] = useState("0.000");
  const [dueDate, setDueDate] = useState("");
  const [receiptMethod, setReceiptMethod] = useState<string>(
    RECEIPT_METHOD_OPTIONS[0],
  );
  // Process 32 — an invoice may be settled in instalments. Blank means "the
  // whole outstanding balance", which is the common case and keeps the
  // one-click full-payment flow intact.
  const [instalmentAmount, setInstalmentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");

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
          : "Could not generate the invoice — try again.",
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
            <strong>{invoice.status}</strong>
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
            Download invoice (PDF)
          </button>
        </div>
      ) : (
        <p style={{ color: "#6b7280" }}>
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
                  createInvoice({
                    policyId: policy.id,
                    taxAmount: taxAmount.trim() || "0",
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

      {invoice && canCollect && invoice.status === "INVOICED" ? (
        <div
          style={{
            display: "grid",
            gap: "0.5rem",
            maxWidth: "22rem",
            marginTop: "0.75rem",
          }}
        >
          <label>
            {t("financeReceivedViaLabel")}
            <select
              value={receiptMethod}
              onChange={(e) => setReceiptMethod(e.target.value)}
              style={{ width: "100%" }}
            >
              {RECEIPT_METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("financeInstalmentAmountLabel")}
            <input
              value={instalmentAmount}
              onChange={(e) => setInstalmentAmount(e.target.value)}
              inputMode="decimal"
              placeholder={invoice.outstandingAmount}
              style={{ width: "100%" }}
            />
          </label>
          <label>
            {t("financePaymentReferenceLabel")}
            <input
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              required
              aria-required="true"
              style={{ width: "100%" }}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              void runStep(async () => {
                const result = await recordReceipt(invoice.id, {
                  // Blank = settle the whole remaining balance.
                  amount: instalmentAmount.trim() || invoice.outstandingAmount,
                  method: receiptMethod,
                  // Mandatory: it is the idempotency key. Without it a
                  // double-click books the client's payment twice.
                  reference: paymentReference.trim(),
                });
                setInstalmentAmount("");
                setPaymentReference("");
                return result;
              }, t("financeCreateError"))
            }
            disabled={busy || paymentReference.trim().length === 0}
            style={buttonStyle}
          >
            {t("financeRecordCollectionButton")}
          </button>
        </div>
      ) : null}

      {invoice && canCollect && invoice.status === "COLLECTED" ? (
        <button
          type="button"
          onClick={() =>
            void runStep(
              () => reconcileInvoice(invoice.id),
              t("financeCreateError"),
            )
          }
          disabled={busy}
          style={{ ...buttonStyle, marginTop: "0.75rem" }}
        >
          {t("financeReconcileButton")}
        </button>
      ) : null}

      {invoice && canCollect && invoice.status === "RECONCILED" ? (
        <button
          type="button"
          onClick={() =>
            void runStep(
              () => recordRemittance(invoice.id),
              t("financeCreateError"),
            )
          }
          disabled={busy}
          style={{ ...buttonStyle, marginTop: "0.75rem" }}
        >
          {t("financeRemitButton", {
            amount: formatMoney(
              invoice.netRemittance,
              language,
              invoice.currency,
            ),
          })}
        </button>
      ) : null}
    </section>
  );
}
