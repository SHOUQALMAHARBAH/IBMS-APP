'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createInvoice,
  listInvoicesForPolicy,
  recordReceipt,
  recordRemittance,
  reconcileInvoice,
  RECEIPT_METHOD_OPTIONS,
  type Invoice,
} from '../../lib/finance/invoice-api';
import {
  listPoliciesForOpportunity,
  type Policy,
} from '../../lib/policy/policy-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { quoteChainCardStyle, quoteFieldStyle } from '../quotation/quotation.styles';

interface Props {
  opportunityId: string;
  /** Finance — raise the premium invoice. */
  canInvoice: boolean;
  /** Finance — drive the collection cycle (receipt / reconcile / remittance). */
  canCollect: boolean;
}

function money(value: string | null, currency = 'JOD'): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n)
    ? `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    : `${currency} ${value}`;
}

/** The section only makes sense once a policy exists with an issued premium —
 * #31 bills `Policy.issuedPremium`. */
export function FinanceSection({
  opportunityId,
  canInvoice,
  canCollect,
}: Props) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [taxAmount, setTaxAmount] = useState('0.000');
  const [feesAmount, setFeesAmount] = useState('0.000');
  const [dueDate, setDueDate] = useState('');
  const [receiptMethod, setReceiptMethod] = useState<string>(
    RECEIPT_METHOD_OPTIONS[0],
  );

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
      setError(err instanceof Error ? err.message : 'Failed to load billing.');
    }
  }, [opportunityId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  if (!policy || policy.issuedPremium === null) return null;

  const invoice = invoices[0] ?? null;

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
    <section style={{ marginTop: '2rem' }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Billing</h2>

      {error ? <p style={errorStyle}>{error}</p> : null}

      {invoice ? (
        <div style={quoteChainCardStyle}>
          <div style={quoteFieldStyle}>
            <span>Premium</span>
            <strong>{money(invoice.premiumAmount, invoice.currency)}</strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>Tax</span>
            <strong>{money(invoice.taxAmount, invoice.currency)}</strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>Fees</span>
            <strong>{money(invoice.feesAmount, invoice.currency)}</strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>Less commission</span>
            <strong>
              −{money(invoice.commissionDeducted, invoice.currency)}
            </strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>Total due</span>
            <strong>{money(invoice.totalAmount, invoice.currency)}</strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>Due date</span>
            <strong>{new Date(invoice.dueDate).toLocaleDateString()}</strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>Status</span>
            <strong>{invoice.status}</strong>
          </div>
          {invoice.receipt ? (
            <div style={quoteFieldStyle}>
              <span>Collected</span>
              <strong>
                {money(invoice.receipt.amount, invoice.currency)}
                {invoice.receipt.method ? ` (${invoice.receipt.method})` : ''}
              </strong>
            </div>
          ) : null}
          {invoice.remittance ? (
            <div style={quoteFieldStyle}>
              <span>Remitted to insurer</span>
              <strong>
                {money(invoice.remittance.amount, invoice.currency)}
                {invoice.remittance.remittedAt
                  ? ` on ${new Date(invoice.remittance.remittedAt).toLocaleDateString()}`
                  : ''}
              </strong>
            </div>
          ) : null}
        </div>
      ) : (
        <p style={{ color: '#6b7280' }}>
          No premium invoice yet. Premium to bill:{' '}
          {money(policy.issuedPremium, policy.currency)} (commission is netted
          automatically from the placed quotation rate).
        </p>
      )}

      {!invoice && canInvoice ? (
        <div style={{ display: 'grid', gap: '0.5rem', maxWidth: '22rem', marginTop: '0.75rem' }}>
          <label>
            Tax amount
            <input
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
              inputMode="decimal"
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Fees amount
            <input
              value={feesAmount}
              onChange={(e) => setFeesAmount(e.target.value)}
              inputMode="decimal"
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Due date
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              void runStep(
                () =>
                  createInvoice({
                    policyId: policy.id,
                    taxAmount: taxAmount.trim() || '0',
                    feesAmount: feesAmount.trim() || '0',
                    dueDate,
                  }),
                'Failed to raise the invoice.',
              )
            }
            disabled={busy || dueDate.trim().length === 0}
            style={buttonStyle}
          >
            Raise premium invoice
          </button>
        </div>
      ) : null}

      {invoice && canCollect && invoice.status === 'INVOICED' ? (
        <div style={{ display: 'grid', gap: '0.5rem', maxWidth: '22rem', marginTop: '0.75rem' }}>
          <label>
            Received via
            <select
              value={receiptMethod}
              onChange={(e) => setReceiptMethod(e.target.value)}
              style={{ width: '100%' }}
            >
              {RECEIPT_METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              void runStep(
                () =>
                  recordReceipt(invoice.id, {
                    amount: invoice.totalAmount,
                    method: receiptMethod,
                  }),
                'Failed to record the receipt.',
              )
            }
            disabled={busy}
            style={buttonStyle}
          >
            Record receipt of {money(invoice.totalAmount, invoice.currency)}
          </button>
        </div>
      ) : null}

      {invoice && canCollect && invoice.status === 'COLLECTED' ? (
        <button
          type="button"
          onClick={() =>
            void runStep(
              () => reconcileInvoice(invoice.id),
              'Failed to reconcile.',
            )
          }
          disabled={busy}
          style={{ ...buttonStyle, marginTop: '0.75rem' }}
        >
          Reconcile collected funds
        </button>
      ) : null}

      {invoice && canCollect && invoice.status === 'RECONCILED' ? (
        <button
          type="button"
          onClick={() =>
            void runStep(
              () => recordRemittance(invoice.id),
              'Failed to record the remittance.',
            )
          }
          disabled={busy}
          style={{ ...buttonStyle, marginTop: '0.75rem' }}
        >
          Remit {money(invoice.netRemittance, invoice.currency)} to insurer
        </button>
      ) : null}
    </section>
  );
}
