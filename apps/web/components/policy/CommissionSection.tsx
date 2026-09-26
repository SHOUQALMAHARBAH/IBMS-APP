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
import { useAuth } from '../../lib/auth/auth-context';
import {
  CombinedDutyReasonField,
  combinedDutyTooShort,
  needsCombinedDutyDeclaration,
} from '../ui/CombinedDutyReasonField';
import { useLanguage } from '../../lib/i18n/language-context';
import { formatMoney } from '../../lib/i18n/format';
import type { TranslationKey } from '../../lib/i18n/translations';

const COMMISSION_STATUS_LABEL_KEY: Record<string, TranslationKey> = {
  outstanding: 'commissionStatusDraft',
  calculated: 'commissionStatusCalculated',
  approved: 'commissionStatusApproved',
  paid: 'financeBillingStatusPaid',
};

interface Props {
  opportunityId: string;
  /** Finance — apply the governed rate + raise a manual override. */
  canCalculate: boolean;
  /** Manager — approve a pending override (never the raiser). */
  canApproveOverride: boolean;
}

export function CommissionSection({
  opportunityId,
  canCalculate,
  canApproveOverride,
}: Props) {
  // Part 4 — read from the session rather than taken as a prop: the office's mode and the viewer's id are not
  // facts about this opportunity, and threading them through would make every caller carry them.
  const { user } = useAuth();
  // The combined-duty reason, keyed by ledger entry so two rows cannot share one box.
  const [declarations, setDeclarations] = useState<Record<string, string>>({});
  const { language, t } = useLanguage();
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
          : t('commissionLoadError'),
      );
    }
  }, [opportunityId, t]);

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
        err instanceof ApiError ? err.message : t('commissionCreateError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>{t('commissionSectionHeading')}</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>{t('commissionIntro')}</p>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}

      {entry ? (
        <div style={quoteChainCardStyle}>
          <div style={quoteFieldStyle}>
            <span>{t('commissionCalculatedLabel')}</span>
            <span>{formatMoney(entry.amount, language)}</span>
          </div>
          <div style={quoteFieldStyle}>
            <span>VAT ({entry.vatRatePercent}%)</span>
            <span>{formatMoney(entry.vatAmount, language)}</span>
          </div>
          <div style={quoteFieldStyle}>
            <span>{t('polCommGrossInclVat')}</span>
            <span>{formatMoney(entry.grossAmount, language)}</span>
          </div>
          <div style={quoteFieldStyle}>
            <span>{t('commissionAmountLabel')}</span>
            <strong>{formatMoney(entry.effectiveAmount, language)}</strong>
          </div>
          <div style={quoteFieldStyle}>
            <span>{t('commissionStatusLabel')}</span>
            <span>{t(COMMISSION_STATUS_LABEL_KEY[entry.status] ?? 'commissionStatusDraft')}</span>
          </div>
          {entry.status === 'paid' ? (
            <div style={quoteFieldStyle}>
              <span>{t('commissionReconciledLabel')}</span>
              <span>
                {formatMoney(entry.paidAmount, language)}
                {entry.paymentReference ? ` · ${entry.paymentReference}` : ''}
              </span>
            </div>
          ) : null}
          {entry.reversedAmount && Number(entry.reversedAmount) > 0 ? (
            <div style={quoteFieldStyle}>
              <span>{t('commissionReversedLabel')}</span>
              <span>
                {formatMoney(entry.reversedAmount, language)}
                {entry.reversalReason ? ` · ${entry.reversalReason}` : ''}
              </span>
            </div>
          ) : null}
          {entry.isManualOverride ? (
            <>
              <div style={quoteFieldStyle}>
                <span>{t('polCommManualOverride')}</span>
                <span>
                  {formatMoney(entry.overrideAmount, language)}{' '}
                  {entry.overridePending
                    ? '(pending approval)'
                    : '(approved)'}
                </span>
              </div>
              {entry.overrideReason ? (
                <div style={quoteFieldStyle}>
                  <span>{t('endorsementCancellationReasonLabel')}</span>
                  <span>{entry.overrideReason}</span>
                </div>
              ) : null}
            </>
          ) : null}

          {canApproveOverride && entry.overridePending
            ? (() => {
                // Part 4 — the person who raised the override may approve it in an office that has declared
                // COMBINED, only by saying why. This is the pair where the money moves furthest from the
                // governed rate, which is why it has a second signature at all.
                const needs = needsCombinedDutyDeclaration({
                  mode: user?.dutySegregationMode,
                  makerUserId: entry.overrideRequestedByUserId,
                  currentUserId: user?.id ?? '',
                  alreadyDecided: entry.overrideApprovedByUserId != null,
                });
                const declaration = declarations[entry.id] ?? '';
                return (
                  <>
                    {needs ? (
                      <CombinedDutyReasonField
                        id={entry.id}
                        value={declaration}
                        onChange={(next) =>
                          setDeclarations((prev) => ({
                            ...prev,
                            [entry.id]: next,
                          }))
                        }
                      />
                    ) : null}
                    <button
                      type="button"
                      style={buttonStyle}
                      disabled={
                        busy || (needs && combinedDutyTooShort(declaration))
                      }
                      onClick={() =>
                        void run(() =>
                          approveCommissionOverride(
                            entry.id,
                            needs ? declaration.trim() : undefined,
                          ),
                        )
                      }
                    >
                      {t('commissionApproveButton')}
                    </button>
                  </>
                );
              })()
            : null}

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
              <label>{t('polCommOverrideAmount')}<input
                  aria-label={t('polCommOverrideAmount')}
                  value={overrideAmount}
                  onChange={(e) => setOverrideAmount(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
              <label>{t('polCommOverrideReason')}<textarea
                  aria-label={t('polCommOverrideReasonAria')}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={10}
                  required
                />
              </label>
              <button type="submit" style={buttonStyle} disabled={busy}>
                {busy ? t('commissionApprovingButton') : t('commissionRaiseOverrideButton')}
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
                Insurer statement amount (must equal {formatMoney(entry.amount, language)})
                <input
                  aria-label={t('polCommStatementAmount')}
                  value={statementAmount}
                  onChange={(e) => setStatementAmount(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
              <label>{t('polCommStatementRef')}<input
                  aria-label={t('polCommPaymentRef')}
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  required
                />
              </label>
              <button type="submit" style={buttonStyle} disabled={busy}>
                {t('polCommissionReconcileMarkPaid')}
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
          {t('commissionCalculateButton')}
        </button>
      ) : (
        <p style={{ color: 'var(--ink-secondary)' }}>{t('commissionNoneYet')}</p>
      )}
    </section>
  );
}
