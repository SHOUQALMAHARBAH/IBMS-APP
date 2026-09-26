'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../lib/i18n/enum-labels';
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
import type { TranslationKey } from '../../lib/i18n/translations';
import {
  DiscardControl,
  DiscardedNotice,
} from '../ui/DiscardControl';
import { useLanguage } from '../../lib/i18n/language-context';
import { formatMoney } from '../../lib/i18n/format';

interface Props {
  opportunityId: string;
  /** Placement — raise / advance / calculate / apply / notify. */
  canManage: boolean;
  /** Manager — approve a return-premium refund above the value threshold. */
  canApproveRefund: boolean;
  /**
   * `endorsement.discard` — its own code, deliberately not implied by `canManage`.
   *
   * This is the control the discard feature exists for: before it, the only exit from a wrongly raised
   * endorsement was to APPLY it, changing a real policy, its premium and its commission, and then correct it
   * with a second endorsement.
   */
  canDiscard: boolean;
}

/** The one action each endorsement status offers, given the caller's role. */
function nextAction(
  e: Endorsement,
  canManage: boolean,
  canApproveRefund: boolean,
  t: (key: TranslationKey) => string,
):
  | { label: string; run: () => Promise<unknown> }
  | null {
  switch (e.status) {
    case 'REQUESTED':
    case 'SUBMITTED_TO_INSURER':
      return canManage
        ? { label: t('endorsementAdvanceButton'), run: () => advanceEndorsement(e.id) }
        : null;
    case 'INSURER_CONFIRMED':
      return canManage
        ? {
            label: t('endorsementCalculateButton'),
            run: () => calculateEndorsementAdjustment(e.id),
          }
        : null;
    case 'FINANCIAL_ADJUSTMENT_CALCULATED':
      return canManage
        ? { label: t('endorsementApplyButton'), run: () => applyEndorsement(e.id) }
        : null;
    case 'REFUND_APPROVAL_PENDING': {
      const refundId = e.refund?.id;
      return canApproveRefund && refundId
        ? {
            label: t('endorsementApproveRefundButton'),
            run: () => approveEndorsementRefund(refundId),
          }
        : null;
    }
    case 'APPLIED':
      return canManage
        ? { label: t('endorsementNotifyButton'), run: () => notifyEndorsementClient(e.id) }
        : null;
    default:
      return null;
  }
}

export function EndorsementSection({
  opportunityId,
  canManage,
  canApproveRefund,
  canDiscard,
}: Props) {
  const { language, t } = useLanguage();
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
          : t('endorsementLoadError'),
      );
    }
  }, [opportunityId, t]);

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
          : t('endorsementActionError'),
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
      <h2 style={{ marginTop: '2.5rem' }}>{t('endorsementSectionHeading')}</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>{t('endorsementIntro')}</p>

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
        <p style={{ color: 'var(--ink-secondary)', marginTop: '1rem' }}>{t('endorsementNoneYet')}</p>
      ) : (
        rows.map((e) => {
          const action = nextAction(e, canManage, canApproveRefund, t);
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
                <span style={rfqBadgeStyle}>{t(ENUM_LABEL.EndorsementStatus[e.status])}</span>
              </div>
              <p style={{ margin: '0.4rem 0' }}>
                Premium adjustment {formatMoney(e.premiumAdjustment, language)}
                {e.commissionReversal
                  ? ` · commission reversal ${formatMoney(e.commissionReversal.amount, language)}`
                  : ''}
              </p>
              {e.cancellation ? (
                <p style={{ margin: '0.4rem 0', fontSize: '0.9rem' }}>
                  Cancellation ({e.cancellation.basis}) · return premium{' '}
                  {formatMoney(e.cancellation.returnPremium, language)}
                </p>
              ) : null}
              {e.refund?.combinedDutyAct ? (
                // Part 4 step 5 — ON THE RECORD, not only in a report. Somebody reading this refund has to see
                // that nobody else signed it without going to find the self-approval report.
                <p
                  data-testid={`combined-duty-${e.refund.id}`}
                  style={{ margin: '0.4rem 0', fontSize: '0.85rem' }}
                >
                  {t('combinedDutyOnRecord', {
                    roles: e.refund.combinedDutyAct.roles.join(', ') || '—',
                  })}{' '}
                  {e.refund.combinedDutyAct.reason}
                </p>
              ) : null}
              {e.refund ? (
                <p style={{ margin: '0.4rem 0', fontSize: '0.9rem' }}>
                  {t('endorsementRefundLabel')} {formatMoney(e.refund.amount, language)} ·{' '}
                  {e.refund.approvedByUserId
                    ? t('endorsementRefundApprovedBy', { user: e.refund.approvedByUserId })
                    : e.refund.needsApproval
                      ? t('endorsementRefundAwaiting')
                      : t('endorsementRefundAutoCleared')}
                </p>
              ) : null}
              <p style={{ color: 'var(--ink-secondary)', fontSize: '0.8rem', margin: '0.4rem 0' }}>
                {e.scheduleVersioned
                  ? t('endorsementNewVersionOpened')
                  : t('endorsementNoVersionYet')}
              </p>
              <DiscardedNotice discard={e.discard} />
              {action && !e.discard ? (
                <button
                  type="button"
                  disabled={busy}
                  style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
                  onClick={() => void run(action.run)}
                >
                  {busy ? t('endorsementWorkingButton') : action.label}
                </button>
              ) : null}
              <DiscardControl
                collection="endorsements"
                id={e.id}
                canDiscard={canDiscard}
                // Everything up to APPLIED, matching `discard.config.ts`. SUBMITTED_TO_INSURER is
                // deliberately still discardable: the insurer has been told, which a discard cannot retract,
                // so whoever withdraws it has to tell them — and the mandatory reason is where that is
                // recorded. Refusing here instead would leave applying it as the only exit, which is the trap.
                discardable={
                  !e.discard &&
                  e.status !== 'APPLIED' &&
                  e.status !== 'CLIENT_NOTIFIED'
                }
                onDiscarded={load}
              />
            </div>
          );
        })
      )}

      {canRaise ? (
        <div style={{ marginTop: '1.5rem', maxWidth: '32rem' }}>
          <strong>{t('endorsementRequestHeading')}</strong>
          <div style={quoteFieldStyle}>
            <label htmlFor="end-type">{t('policyTypeLabel')}</label>
            <select
              id="end-type"
              value={type}
              onChange={(ev) =>
                setType(ev.target.value as 'POSITIVE' | 'NEGATIVE')
              }
            >
              <option value="POSITIVE">{t('endorsementTypePositive')}</option>
              <option value="NEGATIVE">{t('endorsementTypeNegative')}</option>
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="end-change-type">{t('endorsementChangeTypeLabel')}</label>
            <select
              id="end-change-type"
              value={changeType}
              onChange={(ev) =>
                setChangeType(ev.target.value as EndorsementChangeType)
              }
            >
              {ENDORSEMENT_CHANGE_TYPE_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {t(ENUM_LABEL.EndorsementChangeType[c])}
                </option>
              ))}
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="end-premium">{t('endorsementPremiumUnsigned')}</label>
            <input
              id="end-premium"
              inputMode="decimal"
              placeholder="2500.000"
              value={premiumAmount}
              onChange={(ev) => setPremiumAmount(ev.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="end-effective">{t('endorsementEffectiveFromInputLabel')}</label>
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
            {busy ? t('endorsementRequesting') : t('endorsementCreateButton')}
          </button>

          <div style={{ marginTop: '1.5rem' }}>
            <strong>{t('endorsementRequestCancellation')}</strong>
            <div style={quoteFieldStyle}>
              <label htmlFor="cancel-reason">{t('endorsementCancellationReasonLabel')}</label>
              <input
                id="cancel-reason"
                maxLength={2000}
                value={cancelReason}
                onChange={(ev) => setCancelReason(ev.target.value)}
              />
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="cancel-basis">{t('endorsementCancellationBasisLabel')}</label>
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
              <label htmlFor="cancel-date">{t('endorsementCoverCeases')}</label>
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
              {busy ? t('endorsementRequesting') : t('endorsementCancelButton')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
