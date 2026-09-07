'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  approveCommissionOverride,
  calculateCommission,
  listCommissionEntriesForPolicy,
  raiseCommissionOverride,
  settleCommission,
  type CommissionEntry,
} from '../../lib/commission/commission-api';
import {
  listPoliciesForOpportunity,
  type Policy,
} from '../../lib/policy/policy-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { quoteChainCardStyle, quoteFieldStyle } from '../quotation/quotation.styles';

interface Props {
  opportunityId: string;
  /** Finance — apply the governed rate + raise a manual override. */
  canCalculate: boolean;
  /** Manager — approve a pending override (never the raiser). */
  canApproveOverride: boolean;
}

function money(value: string | null, currency = 'JOD'): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n)
    ? `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    : `${currency} ${value}`;
}

export function CommissionSection({
  opportunityId,
  canCalculate,
  canApproveOverride,
}: Props) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [entry, setEntry] = useState<CommissionEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const [overrideAmount, setOverrideAmount] = useState('');
  const [reason, setReason] = useState('');
  const [statementAmount, setStatementAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');

  const load = useCallback(async () => {
    try {
      const policies = await listPoliciesForOpportunity(opportunityId);
      const p = policies[0] ?? null;
      setPolicy(p);
      if (p) {
        setEntry((await listCommissionEntriesForPolicy(p.id))[0] ?? null);
      }
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setHidden(true);
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not load commission — try again.',
      );
    }
  }, [opportunityId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  if (hidden || !policy || policy.issuedPremium == null) return null;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'That action failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Commission</h2>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}

      {entry ? (
        <div style={quoteChainCardStyle}>
          <div style={quoteFieldStyle}>
            <span>Governed amount</span>
            <span>{money(entry.amount)}</span>
          </div>
          <div style={quoteFieldStyle}>
            <span>VAT ({entry.vatRatePercent}%)</span>
            <span>{money(entry.vatAmount)}</span>
          </div>
          <div style={quoteFieldStyle}>
            <span>Gross (incl. VAT)</span>
            <span>{money(entry.grossAmount)}</span>
          </div>
          <div style={quoteFieldStyle}>
            <span>Effective amount</span>
            <strong>{money(entry.effectiveAmount)}</strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>Status</span>
            <span>{entry.status}</span>
          </div>
          {entry.status === 'paid' ? (
            <div style={quoteFieldStyle}>
              <span>Reconciled</span>
              <span>
                {money(entry.paidAmount)}
                {entry.paymentReference ? ` · ${entry.paymentReference}` : ''}
              </span>
            </div>
          ) : null}
          {entry.reversedAmount && Number(entry.reversedAmount) > 0 ? (
            <div style={quoteFieldStyle}>
              <span>Reversed</span>
              <span>
                {money(entry.reversedAmount)}
                {entry.reversalReason ? ` · ${entry.reversalReason}` : ''}
              </span>
            </div>
          ) : null}
          {entry.isManualOverride ? (
            <>
              <div style={quoteFieldStyle}>
                <span>Manual override</span>
                <span>
                  {money(entry.overrideAmount)}{' '}
                  {entry.overridePending
                    ? '(pending approval)'
                    : '(approved)'}
                </span>
              </div>
              {entry.overrideReason ? (
                <div style={quoteFieldStyle}>
                  <span>Reason</span>
                  <span>{entry.overrideReason}</span>
                </div>
              ) : null}
            </>
          ) : null}

          {canApproveOverride && entry.overridePending ? (
            <button
              type="button"
              style={buttonStyle}
              disabled={busy}
              onClick={() => void run(() => approveCommissionOverride(entry.id))}
            >
              Approve override
            </button>
          ) : null}

          {canCalculate &&
          entry.status === 'outstanding' &&
          entry.overrideApprovedByUserId === null ? (
            <form
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                marginTop: '0.75rem',
              }}
              onSubmit={(ev) => {
                ev.preventDefault();
                void run(() =>
                  raiseCommissionOverride(entry.id, {
                    overrideAmount: overrideAmount.trim(),
                    reason: reason.trim(),
                  }),
                );
              }}
            >
              <label>
                Override amount
                <input
                  aria-label="Override amount"
                  value={overrideAmount}
                  onChange={(e) => setOverrideAmount(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
              <label>
                Reason (required, logged)
                <textarea
                  aria-label="Override reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={10}
                  required
                />
              </label>
              <button type="submit" style={buttonStyle} disabled={busy}>
                {entry.isManualOverride
                  ? 'Revise pending override'
                  : 'Raise manual override'}
              </button>
            </form>
          ) : null}

          {canCalculate &&
          entry.status === 'outstanding' &&
          !entry.overridePending ? (
            <form
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                marginTop: '0.75rem',
              }}
              onSubmit={(ev) => {
                ev.preventDefault();
                void run(() =>
                  settleCommission(entry.id, {
                    statementAmount: statementAmount.trim(),
                    paymentReference: paymentReference.trim(),
                  }),
                );
              }}
            >
              <label>
                Insurer statement amount (must equal {money(entry.amount)})
                <input
                  aria-label="Statement amount"
                  value={statementAmount}
                  onChange={(e) => setStatementAmount(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
              <label>
                Statement / payment reference
                <input
                  aria-label="Payment reference"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  required
                />
              </label>
              <button type="submit" style={buttonStyle} disabled={busy}>
                Reconcile &amp; mark paid
              </button>
            </form>
          ) : null}
        </div>
      ) : canCalculate ? (
        <button
          type="button"
          style={buttonStyle}
          disabled={busy}
          onClick={() => void run(() => calculateCommission(policy.id))}
        >
          Calculate commission (governed rate)
        </button>
      ) : (
        <p style={{ opacity: 0.6 }}>No commission entry for this policy yet.</p>
      )}
    </section>
  );
}
