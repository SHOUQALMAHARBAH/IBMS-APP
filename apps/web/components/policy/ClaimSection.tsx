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
import { NotifyClaimForm } from '../claim/NotifyClaimForm';

interface Props {
  opportunityId: string;
  /** Sales / Claims — record a claim notification. */
  canNotify: boolean;
  /** Claims — withdraw a claim notified in error, before it reaches the insurer. */
  canDiscard: boolean;
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
  canDiscard,
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
  /*
   * `busy` and `formError` STAY here, and this is a correction to my own extraction measurement: I checked
   * what the notify block REFERENCED and not what else used the state I was moving. The follow-up sweep
   * button below shares both.
   *
   * `NotifyClaimForm` now owns its own copies, which is better than passing these down: two independent
   * actions get two independent busy flags, so running the insurer follow-up sweep no longer disables the
   * notify button, and a sweep error no longer appears above the notify form as though the form had failed.
   */
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      setLoadError(err instanceof ApiError ? err.message : t('claimLoadError'));
    }
  }, [opportunityId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

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
                  err instanceof ApiError ? err.message : t('claimSweepError'),
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

      {rows.length === 0 ? (
        <p style={{ color: 'var(--ink-secondary)', marginTop: '1rem' }}>
          {t('policyNoClaimsYet')}
        </p>
      ) : (
        rows.map((c) => (
          <ClaimCard
            key={c.id}
            claim={c}
            abilities={{
              canDiscard,
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

      {/*
        The notify form lives in `components/claim/NotifyClaimForm.tsx` — ONE implementation, mounted
        here and on `/policies/[id]`. Extracted rather than duplicated, and this is the second time this
        file has made that move: `ClaimCard` went first, for the same reason and against the same
        permission gate. See that component for why two mount points is the design.
      */}
      <NotifyClaimForm policy={policy} canNotify={canNotify} onDone={load} />
    </section>
  );
}
