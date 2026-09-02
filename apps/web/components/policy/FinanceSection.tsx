'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createInvoice,
  listInvoicesForPolicy,
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
export function FinanceSection({ opportunityId, canInvoice }: Props) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [taxAmount, setTaxAmount] = useState('0.000');
  const [feesAmount, setFeesAmount] = useState('0.000');
  const [dueDate, setDueDate] = useState('');

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

  async function raise() {
    if (!policy) return;
    setBusy(true);
    setError(null);
    try {
      await createInvoice({
        policyId: policy.id,
        taxAmount: taxAmount.trim() || '0',
        feesAmount: feesAmount.trim() || '0',
        dueDate,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to raise the invoice.');
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
            onClick={() => void raise()}
            disabled={busy || dueDate.trim().length === 0}
            style={buttonStyle}
          >
            Raise premium invoice
          </button>
        </div>
      ) : null}
    </section>
  );
}
