'use client';

import { useState } from 'react';
import { ENUM_LABEL } from '../../lib/i18n/enum-labels';
import {
  attachClaimDocuments,
  closeClaim,
  decideClaimAssessment,
  recordAdjusterProgress,
  recordClaimSettlement,
  registerClaim,
  resolveClaimFollowUpAlert,
  secondApproveClaimSettlement,
  submitClaimForAssessment,
  CLAIM_ASSESSMENT_OUTCOMES,
  CLAIM_DOC_CLASSIFICATION_OPTIONS,
  CLAIM_DOC_TYPE_OPTIONS,
  type Claim,
  type ClaimAssessmentOutcome,
  type ClaimDocClassification,
  type ClaimDocType,
} from '../../lib/claim/claim-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { rfqBadgeStyle } from '../rfq/rfq.styles';
import {
  quoteChainCardStyle,
  quoteFieldStyle,
} from '../quotation/quotation.styles';
import {
  DiscardControl,
  DiscardedNotice,
} from '../ui/DiscardControl';
import { useAuth } from '../../lib/auth/auth-context';
import {
  CombinedDutyReasonField,
  combinedDutyTooShort,
  needsCombinedDutyDeclaration,
} from '../ui/CombinedDutyReasonField';
import { useLanguage } from '../../lib/i18n/language-context';
import { formatDate, formatMoney } from '../../lib/i18n/format';
import type { Language, TranslationKey } from '../../lib/i18n/translations';

/*
 * One claim, rendered as the card the Claims desk actually works in — the
 * summary line plus every Process 24-29 sub-block (registration,
 * documentation, assessment, follow-up, settlement, closure).
 *
 * Extracted from `ClaimSection` so the SAME card can render in two places. It
 * used to exist only inside `ClaimSection`, which renders only on
 * `/opportunities/[id]` — a route behind `opportunity.read`, which a
 * CLAIMS_OFFICER does not hold. The role whose entire job is this work had no
 * screen offering it, while the API accepted them perfectly well. Same shape
 * as the Policy Checking Officer gap, and fixed the same way: move the block
 * to a screen the role can reach rather than widen the role.
 *
 * Every sub-block below is keyed by the CLAIM, never by the opportunity, which
 * is what made the extraction possible without changing any of them.
 */

/** What a claim card may offer, per the caller's own permissions. The page
 *  decides; this component only renders what it is told is allowed. */
export interface ClaimCardAbilities {
  /** `claim.discard` — its own code, not implied by the ability to notify one. */
  canDiscard: boolean;
  canRegister: boolean;
  canDocument: boolean;
  canAssess: boolean;
  canFollowUp: boolean;
  canSettle: boolean;
  canSecondApproveSettlement: boolean;
  canClose: boolean;
}

function coverageLabel(
  c: Claim,
  language: Language,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (!c.coverageResolvedAtLossDate || !c.coverage) {
    return t('claimCoverageUnresolved');
  }
  const from = formatDate(c.coverage.effectiveFrom, language);
  const to = c.coverage.effectiveTo
    ? formatDate(c.coverage.effectiveTo, language)
    : t('claimCoverageOpenEnd');
  return t('claimCoverageInForce', { from, to });
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
  const { t } = useLanguage();
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
          : t('claimRegistrationError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.75rem', maxWidth: '30rem' }}>
      <strong style={{ fontSize: '0.9rem' }}>{t('claimRegistrationHeading')}</strong>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
      <div style={quoteFieldStyle}>
        <label htmlFor={`reg-ref-${claimId}`}>{t('claimInsurerRefLabel')}</label>
        <input
          id={`reg-ref-${claimId}`}
          maxLength={200}
          value={insurerRef}
          onChange={(ev) => setInsurerRef(ev.target.value)}
        />
      </div>
      <div style={quoteFieldStyle}>
        <label htmlFor={`reg-num-${claimId}`}>{t('claimBrokerNumberLabel')}</label>
        <input
          id={`reg-num-${claimId}`}
          maxLength={100}
          value={claimNumber}
          onChange={(ev) => setClaimNumber(ev.target.value)}
        />
      </div>
      <div style={quoteFieldStyle}>
        <label htmlFor={`reg-adj-${claimId}`}>{t('claimAdjusterLabel')}</label>
        <input
          id={`reg-adj-${claimId}`}
          maxLength={200}
          dir="auto"
          value={adjusterName}
          onChange={(ev) => setAdjusterName(ev.target.value)}
        />
      </div>
      <div style={quoteFieldStyle}>
        <label htmlFor={`reg-firm-${claimId}`}>{t('claimAdjusterFirmLabel')}</label>
        <input
          id={`reg-firm-${claimId}`}
          maxLength={200}
          dir="auto"
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
        {busy ? t('claimRegisteringButton') : t('claimRegisterButton')}
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
  const { t, tPlural } = useLanguage();
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
          : t('claimDocError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <strong style={{ fontSize: '0.9rem' }}>
        {t('claimDocumentationHeading')}{' '}
        {claim.documentationComplete
          ? `· ${t('claimDocumentationComplete')}`
          : `· ${t('claimDocumentationMissing', { docs: claim.missingMandatoryDocuments.join(', ') })}`}
      </strong>
      <ul style={{ margin: '0.35rem 0', paddingInlineStart: '1.1rem', fontSize: '0.85rem' }}>
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
          {tPlural('claimFilesOnRecord', claim.documents.length)}
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
            <label htmlFor={`doc-type-${claim.id}`}>{t('claimDocTypeLabel')}</label>
            <select
              id={`doc-type-${claim.id}`}
              value={docType}
              onChange={(ev) => setDocType(ev.target.value as ClaimDocType)}
            >
              {CLAIM_DOC_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {t(ENUM_LABEL.ClaimDocType[opt])}
                </option>
              ))}
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor={`doc-class-${claim.id}`}>{t('claimClassificationLabel')}</label>
            <select
              id={`doc-class-${claim.id}`}
              value={classification}
              onChange={(ev) =>
                setClassification(ev.target.value as ClaimDocClassification)
              }
            >
              {CLAIM_DOC_CLASSIFICATION_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {t(ENUM_LABEL.DataClassification[c])}
                </option>
              ))}
            </select>
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor={`doc-name-${claim.id}`}>{t('claimFileNameLabel')}</label>
            <input
              id={`doc-name-${claim.id}`}
              maxLength={300}
              value={fileName}
              onChange={(ev) => setFileName(ev.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor={`doc-ref-${claim.id}`}>{t('claimStorageRefLabel')}</label>
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
            {busy ? t('claimFilingButton') : t('claimFileButton')}
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
  const { t } = useLanguage();
  const { language } = useLanguage();
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
          : t('claimAssessmentError'),
      );
    } finally {
      setBusy(false);
    }
  }

  const stamp = (iso: string | null) =>
    iso ? formatDate(iso, language) : '—';
  // an <input type="date"> yields YYYY-MM-DD; the API accepts a bare date.
  const instant = () => when.trim();

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <strong style={{ fontSize: '0.9rem' }}>{t('claimAssessmentHeading')}</strong>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
      <p style={{ fontSize: '0.85rem', margin: '0.35rem 0' }}>
        {t('polClaimSurveyLabel')} {stamp(a.surveyCompletedAt)} ·{' '}
        {t('polClaimInvestigationLabel')} {stamp(a.investigationCompletedAt)}
        {decided && a.outcome
          ? ` · ${t('polClaimVerdictLabel')} ${t(
              ENUM_LABEL.ClaimStatus[a.outcome],
            )}`
          : ''}
      </p>

      {canAssess && !decided ? (
        <div style={{ maxWidth: '30rem' }}>
          {claim.status !== 'UNDER_ASSESSMENT' ? (
            <>
              <div style={quoteFieldStyle}>
                <label htmlFor={`asmt-when-${claim.id}`}>
                  {t('claimCompletionDateLabel')}
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
                  {t('claimSurveyButton')}
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
                  {t('claimInvestigationButton')}
                </button>
                <button
                  type="button"
                  disabled={busy || !a.readyForAssessment}
                  title={
                    a.readyForAssessment
                      ? undefined
                      : t('claimCompleteDocsFirst')
                  }
                  style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
                  onClick={() =>
                    void run(() => submitClaimForAssessment(claim.id))
                  }
                >
                  {t('claimSubmitButton')}
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <select
                aria-label={t('claimVerdictLabel')}
                value={outcome}
                onChange={(ev) =>
                  setOutcome(ev.target.value as ClaimAssessmentOutcome)
                }
              >
                {CLAIM_ASSESSMENT_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {t(ENUM_LABEL.ClaimStatus[o])}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !a.adjusterWorkComplete}
                title={
                  a.adjusterWorkComplete
                    ? undefined
                    : t('claimAdjusterWorkFirstTitle')
                }
                style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
                onClick={() =>
                  void run(() => decideClaimAssessment(claim.id, outcome))
                }
              >
                {t('claimRecordVerdictButton')}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Process 27 — the insurer non-response follow-up alerts on one claim, with a
 * manual "Resolve" for a Claims Officer who has chased the insurer. */
function ClaimFollowUp({
  claim,
  canFollowUp,
  onDone,
}: {
  claim: Claim;
  canFollowUp: boolean;
  onDone: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const { language, tPlural } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // At most one open alert per claim (partial UNIQUE, migration 20260902190000).
  const alert = claim.followUp.followUpAlerts.find((a) => a.resolvedAt === null);
  if (!alert) return null;

  async function resolve(alertId: string) {
    setBusy(true);
    setError(null);
    try {
      await resolveClaimFollowUpAlert(claim.id, alertId);
      await onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t('claimAlertResolveError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <strong style={{ fontSize: '0.9rem', color: '#b45309' }}>{t('claimFollowUpAlertHeading')}</strong>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
      <p style={{ fontSize: '0.85rem', margin: '0.25rem 0', opacity: 0.8 }}>
        {tPlural(
          'claimFollowUpBusinessDays',
          claim.followUp.followUpAlertThresholdDays,
        )}
        {' — '}
        {t('claimFollowUpRaised', {
          date: formatDate(alert.triggeredAt, language),
        })}
      </p>
      {canFollowUp ? (
        <button
          type="button"
          disabled={busy}
          style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
          onClick={() => void resolve(alert.id)}
        >
          {t('claimResolveAlertButton')}
        </button>
      ) : null}
    </div>
  );
}

const SETTLE_STATUSES: Claim['status'][] = [
  'APPROVED',
  'PARTIALLY_APPROVED',
  'SETTLED',
  'CLOSED',
];

/** Process 28 — the four distinct settlement figures + maker/checker. */
function ClaimSettlement({
  claim,
  canSettle,
  canSecondApproveSettlement,
  onDone,
}: {
  claim: Claim;
  canSettle: boolean;
  canSecondApproveSettlement: boolean;
  onDone: () => Promise<void>;
}) {
  // Part 4 — one box, because this sub-component renders ONE settlement. The queue components key theirs by
  // record id; here there is nothing to key by.
  const [dutyReason, setDutyReason] = useState('');
  const { user } = useAuth();
  const { t } = useLanguage();
  const { language } = useLanguage();
  const [approvedAmount, setApprovedAmount] = useState('');
  const [deductible, setDeductible] = useState('');
  const [brokerProcessedPayment, setBrokerProcessedPayment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!SETTLE_STATUSES.includes(claim.status)) return null;

  const s = claim.settlement;

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
          : t('claimSettlementError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <strong style={{ fontSize: '0.9rem' }}>{t('claimSettlementHeading')}</strong>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}

      {s ? (
        <p style={{ fontSize: '0.85rem', margin: '0.35rem 0' }}>
          {t('claimEstimatedShort')} {formatMoney(s.estimatedLoss, language)} ·{' '}
          {t('claimSettlementApprovedSeparator')}{' '}
          {formatMoney(s.approvedAmount, language)} · {t('claimDeductibleShort')}{' '}
          {formatMoney(s.deductible, language)} · {t('claimNetSettlementShort')}{' '}
          {formatMoney(s.netSettlement, language)}
          {s.brokerProcessedPayment ? ' · broker-processed' : ''}
          {s.secondApproverRequired
            ? s.secondApproverUserId
              ? ' · second-approved'
              : ' · awaiting a second approver'
            : ''}
          {s.settled ? ' · settled' : ''}
        </p>
      ) : null}

      {!s &&
      canSettle &&
      (claim.status === 'APPROVED' ||
        claim.status === 'PARTIALLY_APPROVED') ? (
        <div style={{ maxWidth: '30rem' }}>
          <div style={quoteFieldStyle}>
            <label htmlFor={`stl-appr-${claim.id}`}>{t('claimApprovedAmountLabel')}</label>
            <input
              id={`stl-appr-${claim.id}`}
              inputMode="decimal"
              placeholder="17500.000"
              value={approvedAmount}
              onChange={(ev) => setApprovedAmount(ev.target.value)}
            />
          </div>
          <div style={quoteFieldStyle}>
            <label htmlFor={`stl-ded-${claim.id}`}>{t('poldDeductible')}</label>
            <input
              id={`stl-ded-${claim.id}`}
              inputMode="decimal"
              placeholder="2500.000"
              value={deductible}
              onChange={(ev) => setDeductible(ev.target.value)}
            />
          </div>
          <label style={{ display: 'flex', gap: '0.5rem', margin: '0.5rem 0' }}>
            <input
              type="checkbox"
              checked={brokerProcessedPayment}
              onChange={(ev) => setBrokerProcessedPayment(ev.target.checked)}
            />{t('claimBrokerProcessesPayment')}</label>
          <button
            type="button"
            disabled={
              busy ||
              approvedAmount.trim().length === 0 ||
              deductible.trim().length === 0
            }
            style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
            onClick={() =>
              void run(() =>
                recordClaimSettlement(claim.id, {
                  approvedAmount: approvedAmount.trim(),
                  deductible: deductible.trim(),
                  brokerProcessedPayment: brokerProcessedPayment || undefined,
                }),
              )
            }
          >{t('claimRecordSettlementButton')}</button>
        </div>
      ) : null}

      {s &&
      s.secondApproverRequired &&
      !s.secondApproverUserId &&
      canSecondApproveSettlement
        ? (() => {
            // Part 4 — the person who recorded the settlement may give the mandatory second approval
            // themselves in an office that has declared COMBINED, only by saying why. This is the largest sum
            // in the product that one signature can release, which is why the second one exists.
            //
            // Computed once, like the other eleven approve controls: the field and the button must agree, and
            // two copies of the same condition are two places for them to stop agreeing.
            const needs = needsCombinedDutyDeclaration({
              mode: user?.dutySegregationMode,
              makerUserId: s.approvedByUserId,
              currentUserId: user?.id ?? '',
              alreadyDecided: s.secondApproverUserId != null,
            });
            return (
              <>
                {needs ? (
                  <CombinedDutyReasonField
                    id={claim.id}
                    value={dutyReason}
                    onChange={setDutyReason}
                  />
                ) : null}
                <button
                  type="button"
                  disabled={busy || (needs && combinedDutyTooShort(dutyReason))}
                  style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
                  onClick={() =>
                    void run(() =>
                      secondApproveClaimSettlement(
                        claim.id,
                        needs ? dutyReason.trim() : undefined,
                      ),
                    )
                  }
                >{t('claimSecondApproveButton')}</button>
              </>
            );
          })()
        : null}
    </div>
  );
}

const CLOSURE_STATUSES: Claim['status'][] = ['SETTLED', 'DECLINED', 'CLOSED'];

/** Process 29 — formal closure. A SETTLED claim closes once the client's
 * payment receipt is confirmed; a DECLINED claim closes directly. */
function ClaimClosure({
  claim,
  canClose,
  onDone,
}: {
  claim: Claim;
  canClose: boolean;
  onDone: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const { language } = useLanguage();
  const [confirmedOn, setConfirmedOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!CLOSURE_STATUSES.includes(claim.status)) return null;

  const paymentConfirmed = claim.settlement?.clientPaymentConfirmedAt ?? null;

  async function close(input: { clientPaymentConfirmedAt?: string }) {
    setBusy(true);
    setError(null);
    try {
      await closeClaim(claim.id, input);
      await onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t('claimCloseError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <strong style={{ fontSize: '0.9rem' }}>{t('claimClosureHeading')}</strong>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}

      {claim.status === 'CLOSED' ? (
        <p style={{ fontSize: '0.85rem', margin: '0.35rem 0' }}>
          {t('claimStatusClosed')}{' '}
          {claim.closedAt ? formatDate(claim.closedAt, language) : ''}
          {paymentConfirmed
            ? ` · client payment confirmed ${formatDate(
                paymentConfirmed,
                language,
              )}`
            : ''}
        </p>
      ) : claim.status === 'DECLINED' ? (
        <>
          <p style={{ fontSize: '0.85rem', margin: '0.35rem 0', opacity: 0.8 }}>{t('claimDeclinedNote')}</p>
          {canClose ? (
            <button
              type="button"
              disabled={busy}
              style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
              onClick={() => void close({})}
            >
              {t('claimCloseButton')}
            </button>
          ) : null}
        </>
      ) : paymentConfirmed ? (
        <>
          <p style={{ fontSize: '0.85rem', margin: '0.35rem 0' }}>
            {t('claimClientPaymentConfirmedLabel')}{' '}
            {formatDate(paymentConfirmed, language)}.
          </p>
          {canClose ? (
            <button
              type="button"
              disabled={busy}
              style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
              onClick={() => void close({})}
            >
              {t('claimCloseButton')}
            </button>
          ) : null}
        </>
      ) : canClose ? (
        <div style={{ maxWidth: '30rem' }}>
          <div style={quoteFieldStyle}>
            <label htmlFor={`close-paid-${claim.id}`}>{t('claimClientReceivedOn')}</label>
            <input
              id={`close-paid-${claim.id}`}
              type="date"
              value={confirmedOn}
              onChange={(ev) => setConfirmedOn(ev.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy || confirmedOn.trim().length === 0}
            style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
            onClick={() =>
              void close({ clientPaymentConfirmedAt: confirmedOn.trim() })
            }
          >
            {t('polClaimConfirmPaymentClose')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ClaimCard({
  claim,
  abilities,
  onChanged,
}: {
  claim: Claim;
  abilities: ClaimCardAbilities;
  /** Reload the caller's own view — every sub-block moves the claim on. */
  onChanged: () => Promise<void>;
}) {
  const { language, t } = useLanguage();
  const {
    canDiscard,
    canRegister,
    canDocument,
    canAssess,
    canFollowUp,
    canSettle,
    canSecondApproveSettlement,
    canClose,
  } = abilities;

  return (
    <div style={{ ...quoteChainCardStyle, marginTop: '1rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <strong>
          {t('claimLossOnLabel')} {formatDate(claim.lossDate, language)}
          {claim.isLargeClaim ? ` · ${t('claimLargeClaimSuffix')}` : ''}
        </strong>
        <span style={rfqBadgeStyle}>
          {claim.discard
            ? t('discardedBadge')
            : t(ENUM_LABEL.ClaimStatus[claim.status])}
        </span>
      </div>
      <DiscardedNotice discard={claim.discard} />
      <DiscardControl
        collection="claims"
        id={claim.id}
        canDiscard={canDiscard}
        // NOTIFIED means the client told us; REGISTERED means we told the insurer, and after that there is a
        // claim number in somebody else's system.
        discardable={!claim.discard && claim.status === 'NOTIFIED'}
        onDiscarded={onChanged}
      />
      <p style={{ margin: '0.4rem 0' }}>
        {t('claimEstimatedLossLabel')} {formatMoney(claim.estimatedLoss, language)}
        {claim.claimNumber ? (
          <>
            {' · '}
            <bdi>{claim.claimNumber}</bdi>
          </>
        ) : (
          ''
        )}
      </p>
      {claim.causeOfLoss ? (
        <p style={{ margin: '0.4rem 0', fontSize: '0.9rem' }}>
          <bdi>{claim.causeOfLoss}</bdi>
          {claim.lossLocation ? (
            <>
              {' — '}
              <bdi>{claim.lossLocation}</bdi>
            </>
          ) : (
            ''
          )}
        </p>
      ) : null}
      {claim.isThirdPartyInvolved ? (
        <p style={{ margin: '0.4rem 0', fontSize: '0.9rem' }}>
          {t('claimThirdPartyInvolvedRow')}
          {claim.thirdParty?.fullName ? (
            <>
              {': '}
              <bdi>{claim.thirdParty.fullName}</bdi>
            </>
          ) : (
            ''
          )}
          {claim.thirdParty?.subrogationRecoveryFlag
            ? ` · ${t('claimSubrogationFlagged')}`
            : ''}
        </p>
      ) : null}
      {claim.insurerClaimReference || claim.adjuster ? (
        <p style={{ margin: '0.4rem 0', fontSize: '0.9rem' }}>
          {claim.insurerClaimReference ? (
            <>{t('claimInsurerRefShort')}<bdi>{claim.insurerClaimReference}</bdi>
            </>
          ) : (
            ''
          )}
          {claim.adjuster ? (
            <>
              {claim.insurerClaimReference ? ' · ' : ''}
              {t('claimAdjusterInlineLabel')} <bdi>{claim.adjuster.name}</bdi>
              {claim.adjuster.firm ? (
                <>
                  {' ('}
                  <bdi>{claim.adjuster.firm}</bdi>
                  {')'}
                </>
              ) : (
                ''
              )}
            </>
          ) : (
            ''
          )}
        </p>
      ) : null}
      <p style={{ color: 'var(--ink-secondary)', fontSize: '0.8rem', margin: '0.4rem 0' }}>
        {coverageLabel(claim, language, t)}
      </p>
      {/* Registration is the only forward move from NOTIFIED, and a withdrawn claim is not making it. The
          other sub-blocks below all require a status past NOTIFIED, which a discarded claim can never
          reach — the engine refuses the transition — so this is the one place the flag is needed. */}
      {canRegister && claim.status === 'NOTIFIED' && !claim.discard ? (
        <ClaimRegistrationForm claimId={claim.id} onDone={onChanged} />
      ) : null}
      {claim.status !== 'NOTIFIED' ? (
        <ClaimDocumentation
          claim={claim}
          canDocument={canDocument}
          onDone={onChanged}
        />
      ) : null}
      {claim.status !== 'NOTIFIED' ? (
        <ClaimAssessment
          claim={claim}
          canAssess={canAssess}
          onDone={onChanged}
        />
      ) : null}
      <ClaimFollowUp
        claim={claim}
        canFollowUp={canFollowUp}
        onDone={onChanged}
      />
      <ClaimSettlement
        claim={claim}
        canSettle={canSettle}
        canSecondApproveSettlement={canSecondApproveSettlement}
        onDone={onChanged}
      />
      <ClaimClosure claim={claim} canClose={canClose} onDone={onChanged} />
    </div>
  );
}
