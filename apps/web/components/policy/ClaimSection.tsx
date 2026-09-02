'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listClaimsForPolicy,
  notifyClaim,
  type Claim,
} from '../../lib/claim/claim-api';
import {
  listPoliciesForOpportunity,
  type Policy,
} from '../../lib/policy/policy-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { rfqBadgeStyle } from '../rfq/rfq.styles';
import {
  quoteChainCardStyle,
  quoteFieldStyle,
} from '../quotation/quotation.styles';

interface Props {
  opportunityId: string;
  /** Sales / Claims — record a claim notification. */
  canNotify: boolean;
}

function money(value: string | null): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n)
    ? `JOD ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    : `JOD ${value}`;
}

function coverageLabel(c: Claim): string {
  if (!c.coverageResolvedAtLossDate || !c.coverage) {
    return 'coverage at loss date could not be resolved';
  }
  const from = new Date(c.coverage.effectiveFrom).toLocaleDateString();
  const to = c.coverage.effectiveTo
    ? new Date(c.coverage.effectiveTo).toLocaleDateString()
    : 'open';
  return `coverage version in force: ${from} → ${to}`;
}

export function ClaimSection({ opportunityId, canNotify }: Props) {
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
          : 'Could not load claims — try again.',
      );
    }
  }, [opportunityId]);

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
          : 'That claim could not be recorded — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (policy === undefined) return null;
  // Nothing to show until a policy has been issued (a coverage schedule
  // exists) or claims already sit against it.
  if (!policy || (!policy.issuanceComplete && rows.length === 0)) return null;

  const canRecord = canNotify && policy.issuanceComplete;

  return (
    <section>
      <h2 style={{ marginTop: '2.5rem' }}>Claims</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>
        A reported loss is recorded against the policy at status{' '}
        <strong>NOTIFIED</strong>. Cover is validated against the coverage
        schedule that was in force on the <em>exact loss date</em> — not the
        current one — so a loss under a policy endorsed after the event resolves
        to the version that actually applied then.
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
        <p style={{ opacity: 0.6, marginTop: '1rem' }}>No claims yet.</p>
      ) : (
        rows.map((c) => (
          <div key={c.id} style={{ ...quoteChainCardStyle, marginTop: '1rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '1rem',
                flexWrap: 'wrap',
              }}
            >
              <strong>
                Loss {new Date(c.lossDate).toLocaleDateString()}
                {c.isLargeClaim ? ' · large claim' : ''}
              </strong>
              <span style={rfqBadgeStyle}>{c.status}</span>
            </div>
            <p style={{ margin: '0.4rem 0' }}>
              Estimated loss {money(c.estimatedLoss)}
              {c.claimNumber ? ` · ${c.claimNumber}` : ''}
            </p>
            {c.causeOfLoss ? (
              <p style={{ margin: '0.4rem 0', fontSize: '0.9rem' }}>
                {c.causeOfLoss}
                {c.lossLocation ? ` — ${c.lossLocation}` : ''}
              </p>
            ) : null}
            {c.isThirdPartyInvolved ? (
              <p style={{ margin: '0.4rem 0', fontSize: '0.9rem' }}>
                Third party involved
                {c.thirdParty?.fullName ? `: ${c.thirdParty.fullName}` : ''}
                {c.thirdParty?.subrogationRecoveryFlag
                  ? ' · subrogation/recovery flagged'
                  : ''}
              </p>
            ) : null}
            <p style={{ opacity: 0.6, fontSize: '0.8rem', margin: '0.4rem 0' }}>
              {coverageLabel(c)}
            </p>
          </div>
        ))
      )}

      {canRecord ? (
        <div style={{ marginTop: '1.5rem', maxWidth: '32rem' }}>
          <strong>Notify a claim</strong>
          <div style={quoteFieldStyle}>
            <label htmlFor="claim-loss-date">Loss date</label>
            <input
              id="claim-loss-date"
              type="date"
              value={lossDate}
              onChange={(ev) => setLossDate(ev.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="claim-cause">Cause of loss</label>
            <input
              id="claim-cause"
              maxLength={2000}
              value={causeOfLoss}
              onChange={(ev) => setCauseOfLoss(ev.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="claim-location">Location (optional)</label>
            <input
              id="claim-location"
              maxLength={500}
              value={lossLocation}
              onChange={(ev) => setLossLocation(ev.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor="claim-estimate">Estimated loss</label>
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
            />
            A third party is involved
          </label>
          {thirdParty ? (
            <>
              <div style={quoteFieldStyle}>
                <label htmlFor="claim-tp-name">Third party name (optional)</label>
                <input
                  id="claim-tp-name"
                  maxLength={200}
                  value={tpName}
                  onChange={(ev) => setTpName(ev.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="claim-tp-contact">
                  Third party contact (optional, stored encrypted)
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
                Flag for subrogation / recovery
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
            {busy ? 'Recording…' : 'Notify claim'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
