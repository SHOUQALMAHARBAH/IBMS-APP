'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  attachClaimDocuments,
  decideClaimAssessment,
  listClaimsForPolicy,
  notifyClaim,
  recordAdjusterProgress,
  registerClaim,
  submitClaimForAssessment,
  CLAIM_ASSESSMENT_OUTCOMES,
  CLAIM_DOC_CLASSIFICATION_OPTIONS,
  CLAIM_DOC_TYPE_OPTIONS,
  type Claim,
  type ClaimAssessmentOutcome,
  type ClaimDocClassification,
  type ClaimDocType,
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
  /** Claims — register a NOTIFIED claim with the insurer + assign the adjuster. */
  canRegister: boolean;
  /** Claims — file claim documentation against the mandatory checklist. */
  canDocument: boolean;
  /** Claims — track adjuster progress, submit for assessment, record the verdict. */
  canAssess: boolean;
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

/** Process 24 — a Claims Officer registers a NOTIFIED claim with the insurer
 * and assigns the loss adjuster in one step. */
function ClaimRegistrationForm({
  claimId,
  onDone,
}: {
  claimId: string;
  onDone: () => Promise<void>;
}) {
  const [insurerRef, setInsurerRef] = useState('');
  const [claimNumber, setClaimNumber] = useState('');
  const [adjusterName, setAdjusterName] = useState('');
  const [adjusterFirm, setAdjusterFirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await registerClaim(claimId, {
        insurerClaimReference: insurerRef.trim(),
        claimNumber: claimNumber.trim() || undefined,
        adjuster: {
          name: adjusterName.trim(),
          firm: adjusterFirm.trim() || undefined,
        },
      });
      await onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Registration could not be completed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.75rem', maxWidth: '30rem' }}>
      <strong style={{ fontSize: '0.9rem' }}>Register with the insurer</strong>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
      <div style={quoteFieldStyle}>
        <label htmlFor={`reg-ref-${claimId}`}>Insurer claim reference</label>
        <input
          id={`reg-ref-${claimId}`}
          maxLength={200}
          value={insurerRef}
          onChange={(ev) => setInsurerRef(ev.target.value)}
        />
      </div>
      <div style={quoteFieldStyle}>
        <label htmlFor={`reg-num-${claimId}`}>Broker claim number (optional)</label>
        <input
          id={`reg-num-${claimId}`}
          maxLength={100}
          value={claimNumber}
          onChange={(ev) => setClaimNumber(ev.target.value)}
        />
      </div>
      <div style={quoteFieldStyle}>
        <label htmlFor={`reg-adj-${claimId}`}>Loss adjuster</label>
        <input
          id={`reg-adj-${claimId}`}
          maxLength={200}
          value={adjusterName}
          onChange={(ev) => setAdjusterName(ev.target.value)}
        />
      </div>
      <div style={quoteFieldStyle}>
        <label htmlFor={`reg-firm-${claimId}`}>Adjuster firm (optional)</label>
        <input
          id={`reg-firm-${claimId}`}
          maxLength={200}
          value={adjusterFirm}
          onChange={(ev) => setAdjusterFirm(ev.target.value)}
        />
      </div>
      <button
        type="button"
        disabled={
          busy ||
          insurerRef.trim().length === 0 ||
          adjusterName.trim().length < 2
        }
        style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
        onClick={() => void submit()}
      >
        {busy ? 'Registering…' : 'Register & assign adjuster'}
      </button>
    </div>
  );
}

/** Process 25 — the mandatory-document checklist + a single-file attach form. */
function ClaimDocumentation({
  claim,
  canDocument,
  onDone,
}: {
  claim: Claim;
  canDocument: boolean;
  onDone: () => Promise<void>;
}) {
  const [docType, setDocType] = useState<ClaimDocType>('claim_form');
  const [classification, setClassification] =
    useState<ClaimDocClassification>('CONFIDENTIAL');
  const [fileName, setFileName] = useState('');
  const [storageRef, setStorageRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await attachClaimDocuments(claim.id, [
        {
          docType,
          classification,
          fileName: fileName.trim(),
          storageRef: storageRef.trim(),
        },
      ]);
      setFileName('');
      setStorageRef('');
      await onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'That document could not be filed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <strong style={{ fontSize: '0.9rem' }}>
        Documentation{' '}
        {claim.documentationComplete
          ? '· complete'
          : `· missing ${claim.missingMandatoryDocuments.join(', ')}`}
      </strong>
      <ul style={{ margin: '0.35rem 0', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
        {claim.documentChecklist
          .filter((i) => i.required || i.present)
          .map((i) => (
            <li key={i.docType} style={{ opacity: i.present ? 1 : 0.6 }}>
              {i.present ? '✓' : i.required ? '☐ (required)' : '·'} {i.docType}
            </li>
          ))}
      </ul>
      {claim.documents.length > 0 ? (
        <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: '0.25rem 0' }}>
          {claim.documents.length} file
          {claim.documents.length === 1 ? '' : 's'} on record.
        </p>
      ) : null}

      {canDocument ? (
        <div style={{ maxWidth: '30rem' }}>
          {error ? (
            <p role="alert" style={errorStyle}>
              {error}
            </p>
          ) : null}
          <div style={quoteFieldStyle}>
            <label htmlFor={`doc-type-${claim.id}`}>Document type</label>
            <select
              id={`doc-type-${claim.id}`}
              value={docType}
              onChange={(ev) => setDocType(ev.target.value as ClaimDocType)}
            >
              {CLAIM_DOC_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor={`doc-class-${claim.id}`}>Classification</label>
            <select
              id={`doc-class-${claim.id}`}
              value={classification}
              onChange={(ev) =>
                setClassification(ev.target.value as ClaimDocClassification)
              }
            >
              {CLAIM_DOC_CLASSIFICATION_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor={`doc-name-${claim.id}`}>File name</label>
            <input
              id={`doc-name-${claim.id}`}
              maxLength={300}
              value={fileName}
              onChange={(ev) => setFileName(ev.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor={`doc-ref-${claim.id}`}>Storage reference</label>
            <input
              id={`doc-ref-${claim.id}`}
              maxLength={500}
              value={storageRef}
              onChange={(ev) => setStorageRef(ev.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={
              busy ||
              fileName.trim().length === 0 ||
              storageRef.trim().length === 0
            }
            style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
            onClick={() => void submit()}
          >
            {busy ? 'Filing…' : 'File document'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const ASSESSMENT_ACTIVE: Claim['status'][] = [
  'REGISTERED',
  'DOCUMENTATION_IN_PROGRESS',
  'UNDER_ASSESSMENT',
];

/** Process 26 — adjuster survey/investigation tracking, submit-for-assessment
 * (gated on the checklist), and the insurer's verdict. */
function ClaimAssessment({
  claim,
  canAssess,
  onDone,
}: {
  claim: Claim;
  canAssess: boolean;
  onDone: () => Promise<void>;
}) {
  const [when, setWhen] = useState('');
  const [outcome, setOutcome] =
    useState<ClaimAssessmentOutcome>('PARTIALLY_APPROVED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const a = claim.assessment;
  const decided = a.outcome !== null;
  // `assessment.outcome` reverts to null once the claim reaches SETTLED/CLOSED
  // (it is derived from `status`), so this block hides itself for a settled
  // claim. TODO(#28): the recorded verdict should stay visible once the
  // Settlement section exists — it survives in `statusHistory` meanwhile.
  const show =
    ASSESSMENT_ACTIVE.includes(claim.status) || decided;
  if (!show) return null;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'That assessment step could not be completed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const stamp = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString() : '—';
  // an <input type="date"> yields YYYY-MM-DD; the API accepts a bare date.
  const instant = () => when.trim();

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <strong style={{ fontSize: '0.9rem' }}>Assessment</strong>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
      <p style={{ fontSize: '0.85rem', margin: '0.35rem 0' }}>
        Survey {stamp(a.surveyCompletedAt)} · investigation{' '}
        {stamp(a.investigationCompletedAt)}
        {decided ? ` · verdict ${a.outcome}` : ''}
      </p>

      {canAssess && !decided ? (
        <div style={{ maxWidth: '30rem' }}>
          {claim.status !== 'UNDER_ASSESSMENT' ? (
            <>
              <div style={quoteFieldStyle}>
                <label htmlFor={`asmt-when-${claim.id}`}>
                  Completion date (adjuster survey / investigation)
                </label>
                <input
                  id={`asmt-when-${claim.id}`}
                  type="date"
                  value={when}
                  onChange={(ev) => setWhen(ev.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={busy || instant().length === 0 || !!a.surveyCompletedAt}
                  style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
                  onClick={() =>
                    void run(() =>
                      recordAdjusterProgress(claim.id, {
                        surveyCompletedAt: instant(),
                      }),
                    )
                  }
                >
                  Mark survey complete
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    instant().length === 0 ||
                    !!a.investigationCompletedAt
                  }
                  style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
                  onClick={() =>
                    void run(() =>
                      recordAdjusterProgress(claim.id, {
                        investigationCompletedAt: instant(),
                      }),
                    )
                  }
                >
                  Mark investigation complete
                </button>
                <button
                  type="button"
                  disabled={busy || !a.readyForAssessment}
                  title={
                    a.readyForAssessment
                      ? undefined
                      : 'Complete the mandatory documentation first.'
                  }
                  style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
                  onClick={() =>
                    void run(() => submitClaimForAssessment(claim.id))
                  }
                >
                  Submit for assessment
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <select
                aria-label="Assessment verdict"
                value={outcome}
                onChange={(ev) =>
                  setOutcome(ev.target.value as ClaimAssessmentOutcome)
                }
              >
                {CLAIM_ASSESSMENT_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !a.adjusterWorkComplete}
                title={
                  a.adjusterWorkComplete
                    ? undefined
                    : 'Record the adjuster survey + investigation first.'
                }
                style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
                onClick={() =>
                  void run(() => decideClaimAssessment(claim.id, outcome))
                }
              >
                Record verdict
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ClaimSection({
  opportunityId,
  canNotify,
  canRegister,
  canDocument,
  canAssess,
}: Props) {
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
        to the version that actually applied then. A Claims Officer then
        registers the claim with the insurer and assigns the loss adjuster
        (<strong>REGISTERED</strong>), files the mandatory documentation
        against a per-claim-type checklist (<strong>DOCUMENTATION_IN_PROGRESS</strong>),
        tracks the adjuster&rsquo;s survey / investigation, submits the claim to
        the insurer once the checklist is complete
        (<strong>UNDER_ASSESSMENT</strong>) and records the verdict
        (<strong>APPROVED</strong> / <strong>PARTIALLY_APPROVED</strong> /
        <strong>DECLINED</strong>).
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
            {c.insurerClaimReference || c.adjuster ? (
              <p style={{ margin: '0.4rem 0', fontSize: '0.9rem' }}>
                {c.insurerClaimReference
                  ? `Insurer ref ${c.insurerClaimReference}`
                  : ''}
                {c.adjuster
                  ? `${c.insurerClaimReference ? ' · ' : ''}adjuster ${c.adjuster.name}${
                      c.adjuster.firm ? ` (${c.adjuster.firm})` : ''
                    }`
                  : ''}
              </p>
            ) : null}
            <p style={{ opacity: 0.6, fontSize: '0.8rem', margin: '0.4rem 0' }}>
              {coverageLabel(c)}
            </p>
            {canRegister && c.status === 'NOTIFIED' ? (
              <ClaimRegistrationForm claimId={c.id} onDone={load} />
            ) : null}
            {c.status !== 'NOTIFIED' ? (
              <ClaimDocumentation
                claim={c}
                canDocument={canDocument}
                onDone={load}
              />
            ) : null}
            {c.status !== 'NOTIFIED' ? (
              <ClaimAssessment
                claim={c}
                canAssess={canAssess}
                onDone={load}
              />
            ) : null}
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
