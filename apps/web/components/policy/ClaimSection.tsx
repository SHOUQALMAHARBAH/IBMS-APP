'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listClaimsForPolicy,
  notifyClaim,
  runClaimFollowUpSweep,
  type Claim,
} from '../../lib/claim/claim-api';
import {
  listPoliciesForOpportunity,
  type Policy,
} from '../../lib/policy/policy-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { quoteFieldStyle } from '../quotation/quotation.styles';
import { useLanguage } from '../../lib/i18n/language-context';
// The per-claim card and every Process 24-29 sub-block moved to
// `components/claim/ClaimCard.tsx` so the Claims desk can reach the same card
// from `/claims/[id]`, a route that does not need `opportunity.read`. This
// screen renders the identical component it always did — see that file's
// header for why the extraction was safe.
import { ClaimCard } from '../claim/ClaimCard';

interface Props {
  opportunityId: string;
  /** Sales / Claims — record a claim notification. */
  canNotify: boolean;
  /** Claims — register a NOTIFIED claim with the insurer + assign the adjuster. */
  canRegister: boolean;
  /** Claims — file claim documentation against the mandatory checklist. */
  canDocument: boolean;
  /** Claims — track adjuster progress, submit for assessment, record the verdict. */
  canAssess: boolean;
  /** Claims — run the insurer non-response follow-up sweep, resolve alerts. */
  canFollowUp: boolean;
  /** Claims / Manager — record a settlement's four figures (first approver). */
  canSettle: boolean;
  /** Manager / Finance — the mandatory second approval on a large / broker
   * settlement (never the first approver). */
  canSecondApproveSettlement: boolean;
  /** Claims — formally close a SETTLED (payment confirmed) or DECLINED claim. */
  canClose: boolean;
}

// `t` is passed in rather than read from a hook: this is a plain helper, not a
// component, so it has no hook context of its own.

export function ClaimSection({
  opportunityId,
  canNotify,
  canRegister,
  canDocument,
  canAssess,
  canFollowUp,
  canSettle,
  canSecondApproveSettlement,
  canClose,
}: Props) {
  const { language, t } = useLanguage();
  const [policy, setPolicy] = useState<Policy | null | undefined>(undefined);
  const [rows, setRows] = useState<Claim[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [lossDate, setLossDate] = useState('');
  const [causeOfLoss, setCauseOfLoss] = useState('');
  const [lossLocation, setLossLocation] = useState('');
  const [estimatedLoss, setEstimatedLoss] = useState('');
  const [thirdParty, setThirdParty] = useState(false);
  const [tpName, setTpName] = useState('');
  const [tpContact, setTpContact] = useState('');
  const [tpSubrogation, setTpSubrogation] = useState(false);

  const load = useCallback(async () => {
    try {
      const policies = await listPoliciesForOpportunity(opportunityId);
      const p = policies[0] ?? null;
      setPolicy(p);
      setRows(p ? await listClaimsForPolicy(p.id) : []);
      setLoadError(null);
    } catch (err) {
      setPolicy(null);
      setRows([]);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : t('claimLoadError'),
      );
    }
  }, [opportunityId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function submit() {
    setBusy(true);
    setFormError(null);
    try {
      await notifyClaim({
        policyId: (policy as Policy).id,
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
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : t('claimCreateError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (policy === undefined) return null;
  // A failed load nulls the policy, which then short-circuits the section
  // below and takes the section's own error message down with it — so the
  // block rendered NOTHING when its read failed, and `loadError` was
  // unreachable. Found by Part G item 7, which needs a real error state to
  // photograph and could not produce one.
  if (loadError && !policy) {
    return (
      <section>
        <h2 style={{ marginTop: '2.5rem' }}>{t('claimSectionHeading')}</h2>
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      </section>
    );
  }
  // Nothing to show until a policy has been issued (a coverage schedule
  // exists) or claims already sit against it.
  if (!policy || (!policy.issuanceComplete && rows.length === 0)) return null;

  const canRecord = canNotify && policy.issuanceComplete;

  return (
    <section>
      <h2 style={{ marginTop: '2.5rem' }}>{t('claimSectionHeading')}</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>{t('claimIntro')}</p>

      {canFollowUp ? (
        <button
          type="button"
          disabled={busy}
          style={{ ...buttonStyle, width: 'auto', marginTop: '0.5rem' }}
          onClick={() => {
            setBusy(true);
            setFormError(null);
            void runClaimFollowUpSweep()
              .then(() => load())
              .catch((err) =>
                setFormError(
                  err instanceof ApiError
                    ? err.message
                    : t('claimSweepError'),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? t('claimRunning') : t('claimRunSweepButton')}
        </button>
      ) : null}

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
        <p style={{ color: 'var(--ink-secondary)', marginTop: '1rem' }}>{t('policyNoClaimsYet')}</p>
      ) : (
        rows.map((c) => (
          <ClaimCard
            key={c.id}
            claim={c}
            abilities={{
              canRegister,
              canDocument,
              canAssess,
              canFollowUp,
              canSettle,
              canSecondApproveSettlement,
              canClose,
            }}
            onChanged={load}
          />
        ))
      )}

      {canRecord ? (
        <div style={{ marginTop: '1.5rem', maxWidth: '32rem' }}>
          <strong>{t('claimNotifyButton')}</strong>
          <div style={quoteFieldStyle}>
            <label htmlFor="claim-loss-date">{t('claimLossDueDateLabel')}</label>
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
            <label htmlFor="claim-estimate">{t('claimEstimatedLossLabel')}</label>
            <input
              id="claim-estimate"
              inputMode="decimal"
              placeholder="20000.000"
              value={estimatedLoss}
              onChange={(ev) => setEstimatedLoss(ev.target.value)}
            />
          </div>
          <label
            style={{ display: 'flex', gap: '0.5rem', margin: '0.5rem 0' }}
          >
            <input
              type="checkbox"
              checked={thirdParty}
              onChange={(ev) => setThirdParty(ev.target.checked)}
            />{t('claimThirdPartyInvolved')}</label>
          {thirdParty ? (
            <>
              <div style={quoteFieldStyle}>
                <label htmlFor="claim-tp-name">{t('claimThirdPartyName')}</label>
                <input
                  id="claim-tp-name"
                  maxLength={200}
                  dir="auto"
                  value={tpName}
                  onChange={(ev) => setTpName(ev.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="claim-tp-contact">{t('claimThirdPartyContact')}</label>
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
                />{t('claimSubrogationFlag')}</label>
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
    </section>
  );
}
