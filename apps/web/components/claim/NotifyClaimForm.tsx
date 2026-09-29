'use client';

import { useState } from 'react';
import { notifyClaim } from '../../lib/claim/claim-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { quoteFieldStyle } from '../quotation/quotation.styles';
import { useLanguage } from '../../lib/i18n/language-context';

/**
 * RECORD A CLAIM NOTIFICATION — one implementation, two mount points.
 *
 * ## Why this is extracted rather than duplicated
 *
 * This is the SECOND time this move has been made out of `ClaimSection`, for the same reason and against
 * the same permission gate. The first was `ClaimCard`, and that file's header states it:
 *
 *   > the per-claim card and every Process 24-29 sub-block moved to `components/claim/ClaimCard.tsx` so
 *   > the Claims desk can reach the same card from `/claims/[id]`, a route that does not need
 *   > `opportunity.read`.
 *
 * `claim.notify` was measured (IMPROVEMENTS § 1.84) as reachable from `/opportunities/[id]` and nowhere
 * else — a screen gated on an `opportunity.read` a CLAIMS_OFFICER does not hold. **So a Claims Officer
 * could not raise a claim from anywhere they could navigate to.**
 *
 * ## Two mount points is the design, not a redundancy
 *
 * `claim.notify` is held by TWO roles with different views of the world: SALES_RELATIONSHIP_OFFICER holds
 * `opportunity.read` and works in the pipeline; CLAIMS_OFFICER does not and works from the policy. So this
 * control mounts on `/opportunities/[id]` (via `ClaimSection`, unchanged) and on `/policies/[id]` — one
 * implementation meeting each role where they actually work, which is the frontend directive § 5 rule
 * applied rather than an exception to it.
 *
 * ## The contract
 *
 * Two props beyond the permission, and both already existed at the new mount site:
 *
 *   `policy`  — needs `id` (the payload) and `issuanceComplete` (a claim cannot be notified against a
 *               policy that was never issued). Structurally typed, so any caller holding a policy-shaped
 *               object satisfies it without importing a type it does not otherwise need.
 *   `onDone`  — the refetch after a successful notification. The SAME contract `ClaimCard` and its
 *               sub-blocks already take in this codebase, which is why nothing new had to be invented.
 *
 * Nothing else crossed the boundary: measured before extracting, the block referenced only its own eight
 * field states, `busy`, `submit` and the `canRecord` condition.
 */
interface Props {
  /** `id` for the payload, `issuanceComplete` because an unissued policy cannot have a claim raised. */
  policy: { id: string; issuanceComplete: boolean };
  /** Sales / Claims — `claim.notify`. */
  canNotify: boolean;
  /**
   * Refetch whatever list the caller shows. Awaited, so the caller's rows reflect the new claim before the
   * form clears — the same reason `ClaimCard` takes a promise-returning `onDone` rather than a void one.
   */
  onDone: () => Promise<void>;
}

export function NotifyClaimForm({ policy, canNotify, onDone }: Props) {
  const { t } = useLanguage();

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [lossDate, setLossDate] = useState('');
  const [causeOfLoss, setCauseOfLoss] = useState('');
  const [lossLocation, setLossLocation] = useState('');
  const [estimatedLoss, setEstimatedLoss] = useState('');
  const [thirdParty, setThirdParty] = useState(false);
  const [tpName, setTpName] = useState('');
  const [tpContact, setTpContact] = useState('');
  const [tpSubrogation, setTpSubrogation] = useState(false);

  async function submit() {
    setBusy(true);
    setFormError(null);
    try {
      await notifyClaim({
        policyId: policy.id,
        lossDate,
        causeOfLoss: causeOfLoss.trim(),
        lossLocation: lossLocation.trim() || undefined,
        estimatedLoss: estimatedLoss.trim(),
        isThirdPartyInvolved: thirdParty || undefined,
        thirdParty: thirdParty
          ? {
              fullName: tpName.trim() || undefined,
              contactDetails: tpContact.trim() || undefined,
              subrogationRecoveryFlag: tpSubrogation || undefined,
            }
          : undefined,
      });
      setLossDate('');
      setCauseOfLoss('');
      setLossLocation('');
      setEstimatedLoss('');
      setThirdParty(false);
      setTpName('');
      setTpContact('');
      setTpSubrogation(false);
      await onDone();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : t('claimCreateError'),
      );
    } finally {
      setBusy(false);
    }
  }

  // A claim cannot be raised against a policy that was never issued. Held here rather than at each call
  // site so the rule cannot be stated differently on two screens.
  const canRecord = canNotify && policy.issuanceComplete;

  return (
    <>
      {formError ? (
        <p role="alert" style={errorStyle}>
          {formError}
        </p>
      ) : null}
      {canRecord ? (
        <div style={{ marginTop: '1.5rem', maxWidth: '32rem' }}>
          <strong>{t('claimNotifyButton')}</strong>
          <div style={quoteFieldStyle}>
            <label htmlFor="claim-loss-date">
              {t('claimLossDueDateLabel')}
            </label>
            <input
              id="claim-loss-date"
              type="date"
              value={lossDate}
              onChange={(ev) => setLossDate(ev.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="claim-cause">{t('claimCauseOfLossLabel')}</label>
            <input
              id="claim-cause"
              maxLength={2000}
              dir="auto"
              value={causeOfLoss}
              onChange={(ev) => setCauseOfLoss(ev.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="claim-location">{t('claimLocationLabel')}</label>
            <input
              id="claim-location"
              maxLength={500}
              dir="auto"
              value={lossLocation}
              onChange={(ev) => setLossLocation(ev.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="claim-estimate">
              {t('claimEstimatedLossLabel')}
            </label>
            <input
              id="claim-estimate"
              inputMode="decimal"
              placeholder="20000.000"
              value={estimatedLoss}
              onChange={(ev) => setEstimatedLoss(ev.target.value)}
            />
          </div>
          <label style={{ display: 'flex', gap: '0.5rem', margin: '0.5rem 0' }}>
            <input
              type="checkbox"
              checked={thirdParty}
              onChange={(ev) => setThirdParty(ev.target.checked)}
            />
            {t('claimThirdPartyInvolved')}
          </label>
          {thirdParty ? (
            <>
              <div style={quoteFieldStyle}>
                <label htmlFor="claim-tp-name">
                  {t('claimThirdPartyName')}
                </label>
                <input
                  id="claim-tp-name"
                  maxLength={200}
                  dir="auto"
                  value={tpName}
                  onChange={(ev) => setTpName(ev.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="claim-tp-contact">
                  {t('claimThirdPartyContact')}
                </label>
                <input
                  id="claim-tp-contact"
                  maxLength={500}
                  value={tpContact}
                  onChange={(ev) => setTpContact(ev.target.value)}
                />
              </div>
              <label
                style={{ display: 'flex', gap: '0.5rem', margin: '0.5rem 0' }}
              >
                <input
                  type="checkbox"
                  checked={tpSubrogation}
                  onChange={(ev) => setTpSubrogation(ev.target.checked)}
                />
                {t('claimSubrogationFlag')}
              </label>
            </>
          ) : null}
          <button
            type="button"
            disabled={
              busy ||
              lossDate.trim().length === 0 ||
              causeOfLoss.trim().length < 3 ||
              estimatedLoss.trim().length === 0
            }
            style={{ ...buttonStyle, width: 'auto' }}
            onClick={() => void submit()}
          >
            {busy ? t('claimNotifyingButton') : t('claimNotifySubmitButton')}
          </button>
        </div>
      ) : null}
    </>
  );
}
