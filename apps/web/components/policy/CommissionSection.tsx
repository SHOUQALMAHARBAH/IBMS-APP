'use client';

import { useCallback, useEffect, useState } from 'react';
import { CombinedDutyOnRecord } from '../ui/CombinedDutyOnRecord';
import {
  approveCommissionOverride,
  calculateCommission,
  listCommissionEntriesForPolicy,
  raiseCommissionOverride,
  settleCommission,
  type CommissionEntry,
  type CommissionEntryStatus,
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

/**
 * TOTAL over the three statuses that exist, and NO new Arabic was written for it.
 * Fixed 2026-11-06 (module 0-c batch 6).
 *
 * This was `Record<string, TranslationKey>` over four keys with a `?? 'commissionStatusDraft'`
 * fallback at the call site. Measured against `COMMISSION_ENTRY_STATUSES` in the api, the real set
 * is `outstanding | paid | reversed` — so `calculated` and `approved` were entries for states that
 * CANNOT OCCUR, `reversed` was missing, and `outstanding` pointed at «مسوَّدة» / "Draft". Two of
 * three real statuses therefore rendered as a draft: an entry that is posted but not collected,
 * and one that has been fully clawed back.
 *
 * `Record<CommissionEntryStatus, …>` makes it total, so a fourth status cannot be added to the web
 * union without deciding its word — and the `??` fallback is DELETED rather than left unreachable,
 * the treatment `PROVIDER_CAPABILITY_LABEL_KEY` got for the same reason: a fall-through that can no
 * longer fire is a place for the next drift to hide.
 *
 * ## BOTH REPLACEMENT WORDS ALREADY SHIP, AND NEITHER WAS CHOSEN ON TASTE
 *
 *  - `reversed` → **`frReversed` («المستردّة»), BY OWNER DECISION of 2026-11-07.**
 *
 *    Batch 6 pointed this at `commissionReversedLabel` («معكوسة») on the reasoning that one card
 *    must not use two words for one fact — the amount row said «معكوسة» while the status row said
 *    «مسوَّدة». That reasoning was right about the constraint and could not settle WHICH word,
 *    because the system shipped two Arabic words for a reversed commission: «معكوسة» here and
 *    «المستردّة» on `/financial-report`'s commission roll-up. Batch 6 reported it as the owner's to
 *    decide, and she has: **«المستردّة» wins everywhere.**
 *
 *    So both uses on this card now point at `frReversed`, and `commissionReversedLabel` is
 *    WITHDRAWN in both languages — one home for one fact, rather than two keys agreeing by
 *    convention. The English is unchanged: both keys already read `Reversed`.
 *  - `outstanding` → `frOutstanding` («المستحقة»), which is the column heading of the COMMISSION
 *    roll-up on `/financial-report` (`frEarned` / `frPaid` / `frOutstanding` / `frReversed` over
 *    `data.commission.byInsurer`). Same subject and same state, so this is a pointer at the word
 *    the product already uses for outstanding commission — chosen by provenance rather than by
 *    grammar, which matters because the near-miss candidates (`caColOutstanding`,
 *    `iaColOutstanding`) are the MASCULINE «المستحق» for a different subject.
 *
 * **THAT QUESTION IS NOW CLOSED. It read, until 2026-11-07:** *"ONE THING IS THE OWNER'S AND IS NOT
 * DECIDED HERE: there are now two shipping Arabic words for a reversed commission … Reported, not
 * unified: unifying them means retiring one of her strings."* She decided, and retiring one of her
 * strings is exactly what the decision does — «معكوسة» is withdrawn and «المستردّة» is the word
 * everywhere. Kept as a record rather than deleted, because the reason the batch stopped is the
 * reason it was right to stop.
 *
 * `commissionStatusDraft`, `commissionStatusCalculated` and `commissionStatusApproved` are
 * WITHDRAWN in both languages with this change — measured, their only consumers were this map and
 * the deleted fallback, and all three name states a `CommissionLedgerEntry` can never be in.
 */
const COMMISSION_STATUS_LABEL_KEY: Record<
  CommissionEntryStatus,
  TranslationKey
> = {
  outstanding: 'frOutstanding',
  paid: 'financeBillingStatusPaid',
  reversed: 'frReversed',
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
            <span>{t(COMMISSION_STATUS_LABEL_KEY[entry.status])}</span>
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
              <span>{t('frReversed')}</span>
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
              {/* Part 4 step 5, and the most urgent of the sixteen: the block above prints
                  '(approved)' and names the REQUESTER, so a self-approved override read as a
                  two-person one. Shared renderer — the same sentence as on a refund, a policy's
                  quality check and a data subject request. */}
              <CombinedDutyOnRecord
                act={entry.combinedDutyAct}
                testId={`combined-duty-commission-${entry.id}`}
              />
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
