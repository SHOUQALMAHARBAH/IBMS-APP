'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  advanceEndorsement,
  applyEndorsement,
  approveEndorsementRefund,
  calculateEndorsementAdjustment,
  listEndorsementsForPolicy,
  notifyEndorsementClient,
  requestCancellation,
  requestEndorsement,
  CANCELLATION_BASIS_OPTIONS,
  ENDORSEMENT_CHANGE_TYPE_OPTIONS,
  type CancellationBasis,
  type Endorsement,
  type EndorsementChangeType,
} from '../../lib/endorsement/endorsement-api';
import {
  listPoliciesForOpportunity,
  type Policy,
} from '../../lib/policy/policy-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { rfqBadgeStyle } from '../rfq/rfq.styles';
import { quoteChainCardStyle, quoteFieldStyle } from '../quotation/quotation.styles';

interface Props {
  opportunityId: string;
  /** Placement — raise / advance / calculate / apply / notify. */
  canManage: boolean;
  /** Manager — approve a return-premium refund above the value threshold. */
  canApproveRefund: boolean;
}

function money(value: string | null): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n)
    ? `JOD ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    : `JOD ${value}`;
}

/** The one action each endorsement status offers, given the caller's role. */
function nextAction(
  e: Endorsement,
  canManage: boolean,
  canApproveRefund: boolean,
):
  | { label: string; run: () => Promise<unknown> }
  | null {
  switch (e.status) {
    case 'REQUESTED':
    case 'SUBMITTED_TO_INSURER':
      return canManage
        ? { label: 'Advance to insurer', run: () => advanceEndorsement(e.id) }
        : null;
    case 'INSURER_CONFIRMED':
      return canManage
        ? {
            label: 'Calculate adjustment',
            run: () => calculateEndorsementAdjustment(e.id),
          }
        : null;
    case 'FINANCIAL_ADJUSTMENT_CALCULATED':
      return canManage
        ? { label: 'Apply', run: () => applyEndorsement(e.id) }
        : null;
    case 'REFUND_APPROVAL_PENDING': {
      const refundId = e.refund?.id;
      return canApproveRefund && refundId
        ? {
            label: 'Approve refund',
            run: () => approveEndorsementRefund(refundId),
          }
        : null;
    }
    case 'APPLIED':
      return canManage
        ? { label: 'Notify client', run: () => notifyEndorsementClient(e.id) }
        : null;
    default:
      return null;
  }
}

export function EndorsementSection({
  opportunityId,
  canManage,
  canApproveRefund,
}: Props) {
  const [policy, setPolicy] = useState<Policy | null | undefined>(undefined);
  const [rows, setRows] = useState<Endorsement[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Request-endorsement form.
  const [type, setType] = useState<'POSITIVE' | 'NEGATIVE'>('POSITIVE');
  const [changeType, setChangeType] =
    useState<EndorsementChangeType>('sum_insured_increase');
  const [premiumAmount, setPremiumAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');

  // Cancellation form.
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBasis, setCancelBasis] = useState<CancellationBasis>('pro_rata');
  const [cancelDate, setCancelDate] = useState('');

  const load = useCallback(async () => {
    try {
      const policies = await listPoliciesForOpportunity(opportunityId);
      const p = policies[0] ?? null;
      setPolicy(p);
      setRows(p ? await listEndorsementsForPolicy(p.id) : []);
      setLoadError(null);
    } catch (err) {
      setPolicy(null);
      setRows([]);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : 'Could not load endorsements — try again.',
      );
    }
  }, [opportunityId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'That action could not be completed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (policy === undefined) return null;
  // Nothing to show until a policy exists and either it is ACTIVE (an
  // endorsement can be raised) or it already carries endorsement history.
  if (!policy || (policy.status !== 'ACTIVE' && rows.length === 0)) return null;

  const canRaise = canManage && policy.status === 'ACTIVE';

  return (
    <section>
      <h2 style={{ marginTop: '2.5rem' }}>Endorsements</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>
        Mid-term amendments and cancellations. A negative (return-premium)
        endorsement auto-creates the tied commission reversal; a refund at or
        above the value threshold needs a separate manager approval. Applying an
        endorsement opens a new coverage-schedule version — the prior version is
        never overwritten.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" style={errorStyle}>
          {formError}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: '1rem' }}>No endorsements yet.</p>
      ) : (
        rows.map((e) => {
          const action = nextAction(e, canManage, canApproveRefund);
          return (
            <div key={e.id} style={{ ...quoteChainCardStyle, marginTop: '1rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                <strong>
                  {e.type === 'NEGATIVE' ? '−' : '+'} {e.changeType}
                </strong>
                <span style={rfqBadgeStyle}>{e.status}</span>
              </div>
              <p style={{ margin: '0.4rem 0' }}>
                Premium adjustment {money(e.premiumAdjustment)}
                {e.commissionReversal
                  ? ` · commission reversal ${money(e.commissionReversal.amount)}`
                  : ''}
              </p>
              {e.cancellation ? (
                <p style={{ margin: '0.4rem 0', fontSize: '0.9rem' }}>
                  Cancellation ({e.cancellation.basis}) · return premium{' '}
                  {money(e.cancellation.returnPremium)}
                </p>
              ) : null}
              {e.refund ? (
                <p style={{ margin: '0.4rem 0', fontSize: '0.9rem' }}>
                  Refund {money(e.refund.amount)} ·{' '}
                  {e.refund.approvedByUserId
                    ? `approved by ${e.refund.approvedByUserId}`
                    : e.refund.needsApproval
                      ? 'awaiting manager approval'
                      : 'auto-cleared (below threshold)'}
                </p>
              ) : null}
              <p style={{ opacity: 0.6, fontSize: '0.8rem', margin: '0.4rem 0' }}>
                {e.scheduleVersioned
                  ? 'A new coverage-schedule version was opened.'
                  : 'No schedule version yet.'}
              </p>
              {action ? (
                <button
                  type="button"
                  disabled={busy}
                  style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
                  onClick={() => void run(action.run)}
                >
                  {busy ? 'Working…' : action.label}
                </button>
              ) : null}
            </div>
          );
        })
      )}

      {canRaise ? (
        <div style={{ marginTop: '1.5rem', maxWidth: '32rem' }}>
          <strong>Request an endorsement</strong>
          <div style={quoteFieldStyle}>
            <label htmlFor="end-type">Type</label>
            <select
              id="end-type"
              value={type}
              onChange={(ev) =>
                setType(ev.target.value as 'POSITIVE' | 'NEGATIVE')
              }
            >
              <option value="POSITIVE">Positive (adds premium)</option>
              <option value="NEGATIVE">Negative (returns premium)</option>
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="end-change-type">Change</label>
            <select
              id="end-change-type"
              value={changeType}
              onChange={(ev) =>
                setChangeType(ev.target.value as EndorsementChangeType)
              }
            >
              {ENDORSEMENT_CHANGE_TYPE_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="end-premium">Premium amount (unsigned)</label>
            <input
              id="end-premium"
              inputMode="decimal"
              placeholder="2500.000"
              value={premiumAmount}
              onChange={(ev) => setPremiumAmount(ev.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="end-effective">Effective from</label>
            <input
              id="end-effective"
              type="date"
              value={effectiveFrom}
              onChange={(ev) => setEffectiveFrom(ev.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={
              busy ||
              premiumAmount.trim().length === 0 ||
              effectiveFrom.trim().length === 0
            }
            style={{ ...buttonStyle, width: 'auto' }}
            onClick={() =>
              void run(() =>
                requestEndorsement(policy.id, {
                  type,
                  changeType,
                  premiumAmount: premiumAmount.trim(),
                  effectiveFrom,
                }),
              )
            }
          >
            {busy ? 'Requesting…' : 'Request endorsement'}
          </button>

          <div style={{ marginTop: '1.5rem' }}>
            <strong>Request a cancellation</strong>
            <div style={quoteFieldStyle}>
              <label htmlFor="cancel-reason">Reason</label>
              <input
                id="cancel-reason"
                maxLength={2000}
                value={cancelReason}
                onChange={(ev) => setCancelReason(ev.target.value)}
              />
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="cancel-basis">Basis</label>
              <select
                id="cancel-basis"
                value={cancelBasis}
                onChange={(ev) =>
                  setCancelBasis(ev.target.value as CancellationBasis)
                }
              >
                {CANCELLATION_BASIS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="cancel-date">Cover ceases</label>
              <input
                id="cancel-date"
                type="date"
                value={cancelDate}
                onChange={(ev) => setCancelDate(ev.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={
                busy ||
                cancelReason.trim().length < 3 ||
                cancelDate.trim().length === 0
              }
              style={{ ...buttonStyle, width: 'auto' }}
              onClick={() =>
                void run(() =>
                  requestCancellation(policy.id, {
                    reason: cancelReason.trim(),
                    basis: cancelBasis,
                    effectiveFrom: cancelDate,
                  }),
                )
              }
            >
              {busy ? 'Requesting…' : 'Request cancellation'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
