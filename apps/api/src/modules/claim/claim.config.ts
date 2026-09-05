import { Prisma } from '@ibms/db';
import type { ClaimStatus } from '@ibms/db';
import {
  compareMoney,
  formatMoney,
  quantizeMoney,
  subtractMoney,
} from '../../common/money.util';
import { isFollowUpDue } from '../../common/follow-up.util';

/**
 * Process 23-28 — Claim Notification / Registration / Documentation /
 * Assessment / Follow-up / Settlement (backlog Part C #23-28, Domain C). The
 * pure, deterministic core: resolving the coverage that was in force at the
 * loss date, the drafted large-claim threshold, the mandatory-document
 * checklist per claim type, the assessment-readiness derivation, the per-line
 * follow-up threshold + due predicate, the settlement net-figure + second-
 * approver-required derivation, and the audit `afterValue` snapshots.
 *
 * `ibms-brain/meta/context/claims-lifecycle.md` § "The rules that aren't
 * obvious":
 *  - "A claim must validate against the coverage in force at the loss date,
 *    accounting for endorsement history — not just the current
 *    PolicySchedule."
 *  - "Large claims and any claim payment processed by the broker require a
 *    second approver — maker/checker."
 * and `ibms-brain/meta/context/data-model.md`: "A Claim must resolve to the
 * coverage that was actually in force at the loss date, which may not be the
 * current PolicySchedule if an Endorsement happened in between. Query against
 * Endorsement history, never against `Policy.current_schedule` alone."
 */

// --- coverage in force at the loss date -----------------------------------

/** Why no `PolicySchedule` version covers a given loss date. */
export type CoverageGapReason =
  /** The policy has never been issued — there is no schedule at all. */
  | 'not_issued'
  /** The loss predates the earliest schedule version — cover had not yet
   *  incepted. */
  | 'before_inception'
  /** The loss is on/after the policy expiry, or after the last schedule
   *  version closed with no successor (e.g. a mid-term cancellation) — cover
   *  had ended. */
  | 'after_cover_ended'
  /** The loss falls in a hole BETWEEN two schedule versions (a predecessor
   *  closed before the next one opened). This should not happen — an
   *  endorsement APPLY closes-and-opens contiguously — but the resolver keeps
   *  it distinct rather than mislabelling a data-integrity gap as
   *  "cover ended". */
  | 'coverage_gap';

export type CoverageResolution =
  | {
      ok: true;
      scheduleId: string;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    }
  | { ok: false; reason: CoverageGapReason };

/** One `PolicySchedule` version, reduced to the window fields this resolution
 * needs. The full set of versions for a policy IS the materialised endorsement
 * history — every APPLY of an endorsement (Process 22) closes the open version
 * at its effective date and opens a new one — so iterating them is "querying
 * against endorsement history", not reading the current schedule alone. */
export interface CoverageScheduleWindow {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/**
 * Resolve the coverage that was in force at `lossDate`.
 *
 * A schedule version covers the loss when
 * `effectiveFrom <= lossDate < effectiveTo` (an open version has
 * `effectiveTo === null` and covers everything from its start). This is
 * deliberately NOT "the current open schedule": a policy endorsed AFTER the
 * loss has a newer open version, but the loss must resolve to the (now closed)
 * version that actually applied on the day.
 *
 * The policy `expiryDate` is an independent upper bound — nothing closes the
 * open schedule row at expiry, so its `effectiveTo` stays `null` forever and
 * cannot be relied on to reject a post-expiry loss.
 *
 * Total (never throws): the caller decides whether an `ok: false` is a hard
 * rejection (claim notification) or just an unresolved badge (a later read of
 * a claim whose policy was cancelled forward in the meantime).
 */
export function resolveCoverageAtLossDate(input: {
  schedules: readonly CoverageScheduleWindow[];
  expiryDate: Date | null;
  lossDate: Date;
}): CoverageResolution {
  if (input.schedules.length === 0) {
    return { ok: false, reason: 'not_issued' };
  }
  const t = input.lossDate.getTime();

  if (input.expiryDate && t >= input.expiryDate.getTime()) {
    return { ok: false, reason: 'after_cover_ended' };
  }

  const match = input.schedules.find(
    (s) =>
      s.effectiveFrom.getTime() <= t &&
      (s.effectiveTo === null || t < s.effectiveTo.getTime()),
  );
  if (match) {
    return {
      ok: true,
      scheduleId: match.id,
      effectiveFrom: match.effectiveFrom,
      effectiveTo: match.effectiveTo,
    };
  }

  const froms = input.schedules.map((s) => s.effectiveFrom.getTime());
  const earliest = Math.min(...froms);
  if (t < earliest) {
    return { ok: false, reason: 'before_inception' };
  }
  // t is at/after the earliest version start but no window covers it. If every
  // version has closed and t is at/after the latest close, cover ended;
  // otherwise t sits in a hole between versions (shouldn't happen).
  const allClosed = input.schedules.every((s) => s.effectiveTo !== null);
  const latestClose = allClosed
    ? Math.max(...input.schedules.map((s) => (s.effectiveTo as Date).getTime()))
    : Infinity;
  return {
    ok: false,
    reason:
      allClosed && t >= latestClose ? 'after_cover_ended' : 'coverage_gap',
  };
}

/** The 422 message for a loss that resolves to no in-force coverage. */
export function coverageGapMessage(
  reason: CoverageGapReason,
  ctx: { lossDate: Date; expiryDate: Date | null },
): string {
  const on = ctx.lossDate.toISOString().slice(0, 10);
  switch (reason) {
    case 'not_issued':
      return `This policy has not been issued yet — there is no coverage schedule to validate a loss dated ${on} against.`;
    case 'before_inception':
      return `The loss date ${on} is before this policy's cover incepted — no coverage schedule was in force then.`;
    case 'after_cover_ended':
      return ctx.expiryDate &&
        ctx.lossDate.getTime() >= ctx.expiryDate.getTime()
        ? `The loss date ${on} is on or after the policy expiry (${ctx.expiryDate
            .toISOString()
            .slice(0, 10)}) — cover had ended.`
        : `The loss date ${on} falls after the coverage schedule closed with no successor (e.g. a mid-term cancellation) — cover had ended.`;
    case 'coverage_gap':
      return `The loss date ${on} does not fall within any coverage-schedule version on this policy — check the date, or the policy's schedule history for a gap.`;
  }
}

// --- large-claim flag ----------------------------------------------------

/**
 * The estimated-loss value at / above which a claim is flagged
 * `isLargeClaim` — a large claim (and any broker-processed claim payment)
 * needs a second approver at settlement (Process 28,
 * `ibms-brain/meta/lex/maker-checker-segregation.md`).
 *
 * **`ibms-app` product decision, drafted, unsourced** — no CBJ / Part-3.7 /
 * broker authority-matrix figure specifies it (the worked example in
 * `claims-lifecycle.md` uses an Estimated Loss of JOD 20,000 as a *routine*
 * claim, which weakly places the large threshold above that). Same
 * drafted-constant precedent as #16's 10% / 2 pp bands and #22's
 * `REFUND_APPROVAL_THRESHOLD_JOD`. Filed via `/brain-gap` into
 * `ibms-brain/meta/context/claims-lifecycle.md`.
 *
 * This flag is a NOTIFICATION-TIME SNAPSHOT and is advisory only: Process 28
 * must re-derive the second-approver requirement from live data (the approved
 * amount, once known) at the settlement decision point — never trust this
 * snapshot as the gate (the #16 review generalisation:
 * "gates are re-derived from live data at the decision point").
 */
export const CLAIM_LARGE_THRESHOLD_JOD = '25000.000';

/** True when `estimatedLoss` is at / above {@link CLAIM_LARGE_THRESHOLD_JOD}. */
export function isLargeClaim(estimatedLoss: Prisma.Decimal | string): boolean {
  return quantizeMoney(estimatedLoss).greaterThanOrEqualTo(
    CLAIM_LARGE_THRESHOLD_JOD,
  );
}

// --- audit snapshots (metadata + money as strings, never free text) --------

/**
 * CREATE audit `afterValue` for a notified claim. The `Claim` row is
 * `HIGHLY_CONFIDENTIAL` by classification (it may describe a medical event or
 * name an injured person), so the free-text `causeOfLoss` / `lossLocation`
 * are recorded only as presence booleans — never their content
 * (`ibms-brain/meta/lex/sensitive-data-handling.md`). Money as a fixed 3dp
 * string; the resolved coverage window as ids + dates, no coverage figures.
 */
export function claimNotificationAuditSnapshot(row: {
  id: string;
  policyId: string;
  customerId: string;
  status: string;
  lossDate: Date;
  estimatedLoss: Prisma.Decimal;
  isThirdPartyInvolved: boolean;
  isLargeClaim: boolean;
  hasLossLocation: boolean;
  coverageScheduleId: string;
  coverageEffectiveFrom: Date;
  coverageEffectiveTo: Date | null;
}): Prisma.InputJsonObject {
  return {
    claimId: row.id,
    policyId: row.policyId,
    customerId: row.customerId,
    status: row.status,
    lossDate: row.lossDate.toISOString(),
    estimatedLoss: formatMoney(row.estimatedLoss),
    isThirdPartyInvolved: row.isThirdPartyInvolved,
    isLargeClaim: row.isLargeClaim,
    hasLossLocation: row.hasLossLocation,
    coverageScheduleId: row.coverageScheduleId,
    coverageEffectiveFrom: row.coverageEffectiveFrom.toISOString(),
    coverageEffectiveTo: row.coverageEffectiveTo
      ? row.coverageEffectiveTo.toISOString()
      : null,
  };
}

/**
 * CREATE audit `afterValue` for the `ThirdPartyClaimant` child. The claimant
 * name is Confidential PII and the contact details are `-- ENCRYPT` — neither
 * goes in the trail; only the presence booleans and the
 * subrogation/recovery flag (the distinct piece of state that drives its own
 * downstream process, `claims-lifecycle.md`).
 */
export function thirdPartyClaimantAuditSnapshot(row: {
  id: string;
  claimId: string;
  hasFullName: boolean;
  hasContactDetails: boolean;
  subrogationRecoveryFlag: boolean;
}): Prisma.InputJsonObject {
  return {
    thirdPartyClaimantId: row.id,
    claimId: row.claimId,
    hasFullName: row.hasFullName,
    hasContactDetails: row.hasContactDetails,
    subrogationRecoveryFlag: row.subrogationRecoveryFlag,
  };
}

/**
 * CREATE audit `afterValue` for the loss `Adjuster` assigned at registration
 * (Process 24). The adjuster is a professional loss-assessment firm / person —
 * NOT the insured or the claimant — so the name + firm go in the trail, the
 * same tier as the delivery `recipient` on a #21 `DeliveryRecord` audit row.
 */
export function adjusterAuditSnapshot(row: {
  id: string;
  claimId: string;
  name: string;
  firm: string | null;
  assignedAt: Date;
}): Prisma.InputJsonObject {
  return {
    adjusterId: row.id,
    claimId: row.claimId,
    name: row.name,
    firm: row.firm,
    assignedAt: row.assignedAt.toISOString(),
  };
}

/**
 * UPDATE audit `afterValue` for the registration scalars the workflow engine's
 * TRANSITION row (before / after `status` only) does not capture — the
 * insurer's claim reference and, if the broker assigned one now, the internal
 * claim number. Both are administrative identifiers, not sensitive personal
 * data.
 */
export function claimRegistrationAuditSnapshot(row: {
  claimId: string;
  insurerClaimReference: string;
  claimNumber: string | null;
}): Prisma.InputJsonObject {
  return {
    claimId: row.claimId,
    insurerClaimReference: row.insurerClaimReference,
    claimNumber: row.claimNumber,
  };
}

// --- Process 25: the mandatory document checklist per claim type ----------

/** The claim-documentation types (schema `ClaimDocument.docType`, Part 3.7 —
 * claim form / police report / medical report / photos / invoices / repair
 * estimate / expert report, plus supplementary correspondence). Stable order
 * — the checklist is rendered in it. */
export const CLAIM_DOC_TYPES = [
  'claim_form',
  'police_report',
  'medical_report',
  'photo',
  'invoice',
  'repair_estimate',
  'expert_report',
  'correspondence',
] as const;
export type ClaimDocType = (typeof CLAIM_DOC_TYPES)[number];

/** A `medical_report` is Sensitive / Highly Confidential Personal Data under
 * PDPL (`claims-lifecycle.md` § "Health/medical claim data ... a
 * classification-driven handling requirement from first contact") — it may
 * only be recorded at `HIGHLY_CONFIDENTIAL`. */
export const MEDICAL_REPORT_DOC_TYPE: ClaimDocType = 'medical_report';

/** The broad line families the mandatory-document matrix keys off. */
export type ClaimLineFamily =
  'property' | 'motor' | 'medical' | 'liability' | 'marine' | 'other';

/**
 * Classify a free-text `Policy.insuranceLine` into a {@link ClaimLineFamily}
 * by keyword. `insuranceLine` is an un-enumerated string across this codebase
 * (`RFQ` / `Policy`), so this is a heuristic — same shape as
 * `cross-sell.config.ts`'s line matching. Order matters: the more specific
 * families are tested first.
 *
 * **`ibms-app` product decision, drafted, unsourced** — Part 3.7 lists the
 * document *types* but no per-line mandatory matrix, and there is no line
 * taxonomy. Filed via `/brain-gap`.
 */
export function classifyInsuranceLine(insuranceLine: string): ClaimLineFamily {
  const s = insuranceLine.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/\b(motor|vehicle|fleet|automobile|auto)\b/.test(s)) return 'motor';
  if (/\b(marine|cargo|hull|transit|goods in transit)\b/.test(s)) {
    return 'marine';
  }
  if (
    /\b(medical|health|life|hospital|group personal accident|gpa|personal accident)\b/.test(
      s,
    )
  ) {
    return 'medical';
  }
  if (
    /\b(liability|indemnity|professional indemnity|d&o|directors|errors|negligence)\b/.test(
      s,
    )
  ) {
    return 'liability';
  }
  if (
    /(\bpropert\w*|\bfire\b|\ball risks\b|\bcontents\b|\bbusiness interruption\b|\bengineering\b|\bmachinery\b|\berection\b|\bconstruction\b|\bburglary\b|\btheft\b)/.test(
      s,
    )
  ) {
    return 'property';
  }
  return 'other';
}

/**
 * The mandatory `docType`s for a claim, in {@link CLAIM_DOC_TYPES} order.
 * Every claim needs a `claim_form`; a third-party-involved loss additionally
 * needs a `police_report` (`claims-lifecycle.md` — "third-party claims carry
 * additional data"); the rest is the per-line-family matrix.
 *
 * **`ibms-app` product decision, drafted, unsourced** (see
 * `classifyInsuranceLine`). `correspondence` is never mandatory. The `docType`
 * enum has no "financial statements" value, so a Business Interruption claim
 * (classified `property`) inherits `photo` / `repair_estimate` rather than an
 * accounts requirement — noted in the `/brain-gap`.
 */
export function mandatoryDocTypesFor(input: {
  insuranceLine: string;
  isThirdPartyInvolved: boolean;
}): ClaimDocType[] {
  const required = new Set<ClaimDocType>(['claim_form']);
  if (input.isThirdPartyInvolved) required.add('police_report');
  switch (classifyInsuranceLine(input.insuranceLine)) {
    case 'property':
      required.add('photo').add('repair_estimate');
      break;
    case 'motor':
      required.add('photo').add('repair_estimate').add('police_report');
      break;
    case 'medical':
      required.add('medical_report').add('invoice');
      break;
    case 'liability':
      required.add('expert_report');
      break;
    case 'marine':
      required.add('photo').add('expert_report');
      break;
    case 'other':
      break;
  }
  return CLAIM_DOC_TYPES.filter((t) => required.has(t));
}

export interface ClaimDocChecklistItem {
  docType: ClaimDocType;
  required: boolean;
  present: boolean;
}

/**
 * The full per-`docType` checklist (all {@link CLAIM_DOC_TYPES}, in order),
 * plus the derived `documentationComplete` (every `required` item is
 * `present`) and the `missing` mandatory types. Pure.
 */
export function buildDocumentChecklist(
  mandatory: readonly ClaimDocType[],
  presentDocTypes: readonly string[],
): {
  checklist: ClaimDocChecklistItem[];
  documentationComplete: boolean;
  missing: ClaimDocType[];
} {
  const mandatorySet = new Set(mandatory);
  const presentSet = new Set(presentDocTypes);
  const checklist = CLAIM_DOC_TYPES.map((docType) => ({
    docType,
    required: mandatorySet.has(docType),
    present: presentSet.has(docType),
  }));
  const missing = mandatory.filter((t) => !presentSet.has(t));
  return { checklist, documentationComplete: missing.length === 0, missing };
}

/**
 * CREATE audit `afterValue` for a `ClaimDocument` / its `Document`. Like the
 * #18-19 `policyDocumentAuditSnapshot` this **excludes `fileName` and
 * `storageRef`** — a claim document's filename can name an injured person or
 * describe a medical event (HIGHLY_CONFIDENTIAL), and `storageRef` is an
 * internal object-storage key. Only ids / type / category / classification.
 */
export function claimDocumentAuditSnapshot(row: {
  claimDocumentId: string;
  documentId: string;
  claimId: string;
  docType: string;
  category: string;
  classification: string;
  uploadedByUserId: string;
}): Prisma.InputJsonObject {
  return {
    claimDocumentId: row.claimDocumentId,
    documentId: row.documentId,
    claimId: row.claimId,
    docType: row.docType,
    category: row.category,
    classification: row.classification,
    uploadedByUserId: row.uploadedByUserId,
  };
}

// --- Process 26: claim assessment ----------------------------------------

/** The insurer's assessment verdict — the three terminal outcomes of the
 * `UNDER_ASSESSMENT` phase (`WORKFLOW_TRANSITIONS.Claim`). `DECLINED` goes
 * straight to `CLOSED` (no payment); `APPROVED` / `PARTIALLY_APPROVED` pass
 * through `SETTLED` where the four distinct figures are recorded (Process 28).
 * Stable order — the UI renders it. */
export const CLAIM_ASSESSMENT_OUTCOMES = [
  'APPROVED',
  'PARTIALLY_APPROVED',
  'DECLINED',
] as const;
export type ClaimAssessmentOutcome = (typeof CLAIM_ASSESSMENT_OUTCOMES)[number];

/** True once the assessment phase is over — `status` is one of the three
 * verdicts, or past them (`SETTLED` / `CLOSED`). Distinct from
 * `CLAIM_ASSESSMENT_OUTCOMES.includes(status)`, which is true only for the
 * verdict itself (that narrower test is what `deriveAssessmentView` uses for
 * the `outcome` field). */
export function isAssessmentConcluded(status: string): boolean {
  return (
    (CLAIM_ASSESSMENT_OUTCOMES as readonly string[]).includes(status) ||
    status === 'SETTLED' ||
    status === 'CLOSED'
  );
}

export interface AssessmentView {
  surveyCompletedAt: Date | null;
  investigationCompletedAt: Date | null;
  /** Both adjuster timestamps are set — the loss adjuster has finished the
   * survey AND the investigation. `ibms-app` gates the `UNDER_ASSESSMENT →
   * verdict` move on this (drafted, unsourced — see the `/brain-gap`). */
  adjusterWorkComplete: boolean;
  /** The claim is `DOCUMENTATION_IN_PROGRESS` with every mandatory document on
   * file — the `→ UNDER_ASSESSMENT` move is unblocked. */
  readyForAssessment: boolean;
  /** The recorded verdict, derived from `status` (null until decided). */
  outcome: ClaimAssessmentOutcome | null;
}

/** Derive the assessment sub-view from the claim's status, the (live)
 * documentation-complete flag and the adjuster's two completion stamps. Pure.
 */
export function deriveAssessmentView(input: {
  status: string;
  documentationComplete: boolean;
  surveyCompletedAt: Date | null;
  investigationCompletedAt: Date | null;
}): AssessmentView {
  return {
    surveyCompletedAt: input.surveyCompletedAt,
    investigationCompletedAt: input.investigationCompletedAt,
    adjusterWorkComplete:
      input.surveyCompletedAt !== null &&
      input.investigationCompletedAt !== null,
    readyForAssessment:
      input.status === 'DOCUMENTATION_IN_PROGRESS' &&
      input.documentationComplete,
    outcome: (CLAIM_ASSESSMENT_OUTCOMES as readonly string[]).includes(
      input.status,
    )
      ? (input.status as ClaimAssessmentOutcome)
      : null,
  };
}

/**
 * UPDATE audit `afterValue` for the loss `Adjuster`'s survey / investigation
 * completion stamps (Process 26). The adjuster is a professional
 * loss-assessment firm — not the claimant — so ids + the two ISO timestamps
 * are fine in the trail (same tier as {@link adjusterAuditSnapshot}). No claim
 * narrative.
 */
export function adjusterAssessmentAuditSnapshot(row: {
  adjusterId: string;
  claimId: string;
  surveyCompletedAt: Date | null;
  investigationCompletedAt: Date | null;
}): Prisma.InputJsonObject {
  return {
    adjusterId: row.adjusterId,
    claimId: row.claimId,
    surveyCompletedAt: row.surveyCompletedAt
      ? row.surveyCompletedAt.toISOString()
      : null,
    investigationCompletedAt: row.investigationCompletedAt
      ? row.investigationCompletedAt.toISOString()
      : null,
  };
}

// --- Process 27: claim follow-up (insurer non-response) ------------------

/** The pre-verdict statuses in which the claim is "awaiting a response from
 * the insurer" — the ball is in the insurer's court (they registered it and
 * must engage / assess / decide). Once a verdict is recorded (`APPROVED` /
 * `PARTIALLY_APPROVED` / `DECLINED`) or the claim is beyond that, the insurer
 * has responded and any open follow-up alert is resolvable. */
export const CLAIM_AWAITING_INSURER_STATUSES: readonly ClaimStatus[] = [
  'REGISTERED',
  'DOCUMENTATION_IN_PROGRESS',
  'UNDER_ASSESSMENT',
];

/** The neutral default follow-up threshold — the Part 3.7 worked example
 * ("no response after 9 days from a 1 August submission triggers an alert on
 * day 10"), also the `Claim.followUpAlertThresholdDays` schema `@default`. */
export const DEFAULT_CLAIM_FOLLOWUP_THRESHOLD_DAYS = 9;

/**
 * The follow-up threshold (Jordan business days since the claim was
 * `REGISTERED` with the insurer) per broad line family — "configurable per
 * line" (backlog #27).
 *
 * **`ibms-app` product decision, drafted, unsourced** — Part 3.7 gives ONE
 * worked example (9 days) and no per-line table; `Policy.insuranceLine` has
 * no taxonomy, so the family comes from {@link classifyInsuranceLine}. Same
 * drafted-constant status as `CLAIM_LARGE_THRESHOLD_JOD` (#23), the #25
 * checklist matrix, #16's 10 % / 2 pp. Filed via `/brain-gap`.
 */
export const CLAIM_FOLLOWUP_THRESHOLD_DAYS_BY_FAMILY: Record<
  ClaimLineFamily,
  number
> = {
  motor: 7,
  property: 10,
  medical: 7,
  liability: 15,
  marine: 15,
  other: DEFAULT_CLAIM_FOLLOWUP_THRESHOLD_DAYS,
};

/** Resolve the follow-up threshold for a claim from its policy's free-text
 * `insuranceLine`. Snapshotted onto `Claim.followUpAlertThresholdDays` at
 * notification (Process 23) so a later taxonomy change does not retroactively
 * shift live claims — the sweep reads the column, not this map. */
export function followUpThresholdDaysFor(insuranceLine: string): number {
  return CLAIM_FOLLOWUP_THRESHOLD_DAYS_BY_FAMILY[
    classifyInsuranceLine(insuranceLine)
  ];
}

/** Is a follow-up alert now due for a claim registered at `registeredAt` with
 * a `thresholdDays` grace window? Thin wrapper over the shared
 * {@link isFollowUpDue} (Jordan business days, `now` injected). */
export function isClaimFollowUpDue(
  registeredAt: Date,
  thresholdDays: number,
  now: Date,
): boolean {
  return isFollowUpDue(registeredAt, thresholdDays, now);
}

export interface ClaimFollowUpAlertView {
  id: string;
  triggeredAt: Date;
  resolvedAt: Date | null;
}

export interface ClaimFollowUpView {
  followUpAlerts: ClaimFollowUpAlertView[];
  /** At least one alert has no `resolvedAt`. */
  followUpAlertOpen: boolean;
  followUpAlertThresholdDays: number;
  /** The claim is in a pre-verdict status — the insurer still owes a
   * response. */
  awaitingInsurerResponse: boolean;
  /** When the claim was `REGISTERED` with the insurer — the follow-up clock
   * start (null before registration, or if the history row is somehow
   * absent). */
  awaitingInsurerSince: Date | null;
}

/** Derive the Process 27 follow-up sub-view. Pure. */
export function deriveFollowUpView(input: {
  status: string;
  followUpAlertThresholdDays: number;
  registeredAt: Date | null;
  alerts: readonly { id: string; triggeredAt: Date; resolvedAt: Date | null }[];
}): ClaimFollowUpView {
  const followUpAlerts = input.alerts.map((a) => ({
    id: a.id,
    triggeredAt: a.triggeredAt,
    resolvedAt: a.resolvedAt,
  }));
  return {
    followUpAlerts,
    followUpAlertOpen: followUpAlerts.some((a) => a.resolvedAt === null),
    followUpAlertThresholdDays: input.followUpAlertThresholdDays,
    awaitingInsurerResponse: (
      CLAIM_AWAITING_INSURER_STATUSES as readonly string[]
    ).includes(input.status),
    awaitingInsurerSince: input.registeredAt,
  };
}

/**
 * CREATE / UPDATE audit `afterValue` for a `ClaimFollowUpAlert`. It is an
 * accountability record — ids, the threshold and the clock timestamps only,
 * never any claim narrative. `thresholdDays` / `registeredAt` are the raise
 * context (omitted on a plain resolve, where they are not to hand).
 */
export function claimFollowUpAlertAuditSnapshot(row: {
  claimFollowUpAlertId: string;
  claimId: string;
  triggeredAt: Date;
  resolvedAt: Date | null;
  resolvedBy?: 'sweep' | 'manual';
  thresholdDays?: number;
  registeredAt?: Date | null;
}): Prisma.InputJsonObject {
  return {
    claimFollowUpAlertId: row.claimFollowUpAlertId,
    claimId: row.claimId,
    triggeredAt: row.triggeredAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    ...(row.resolvedBy ? { resolvedBy: row.resolvedBy } : {}),
    ...(row.thresholdDays !== undefined
      ? { thresholdDays: row.thresholdDays }
      : {}),
    ...(row.registeredAt !== undefined
      ? {
          registeredAt: row.registeredAt
            ? row.registeredAt.toISOString()
            : null,
        }
      : {}),
  };
}

// --- Process 28: claim settlement --------------------------------------

/**
 * The claim statuses from which a settlement can be recorded — the two
 * `WORKFLOW_TRANSITIONS.Claim` predecessors of `SETTLED`. A `DECLINED` claim
 * has no payout (it goes straight to `CLOSED` at Process 29).
 */
export const CLAIM_SETTLEABLE_STATUSES: readonly ClaimStatus[] = [
  'APPROVED',
  'PARTIALLY_APPROVED',
];

/** True while a settlement can still be recorded / applied — mirrors
 * {@link isAssessmentConcluded}, so call sites do not repeat the
 * `as readonly string[]` cast. */
export function isSettleableStatus(status: string): boolean {
  return (CLAIM_SETTLEABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Net settlement = approved amount − deductible, quantized to fils. **Always
 * computed, never hand-entered** — the "four distinct figures ... collapsing
 * these into one number loses the audit trail" rule
 * (`claims-lifecycle.md`) cuts both ways: the figures are distinct AND
 * derived consistently. Pure.
 */
export function computeNetSettlement(
  approvedAmount: Prisma.Decimal | string,
  deductible: Prisma.Decimal | string,
): Prisma.Decimal {
  return subtractMoney(approvedAmount, deductible);
}

/**
 * Is a mandatory SECOND approver required for this settlement? Re-derived
 * from LIVE data at the decision point (`claims-lifecycle.md` — never trust
 * `Claim.isLargeClaim`, the notification-time snapshot): the settlement is
 * "large" iff the **approved amount** is at / above
 * {@link CLAIM_LARGE_THRESHOLD_JOD} (the same drafted, unsourced threshold
 * `isLargeClaim` uses, now applied to the approved figure), **or** the broker
 * is processing the payment (Part 3.7 — "any claim payment the broker
 * processes"). Pure.
 */
export function isSecondApproverRequired(input: {
  approvedAmount: Prisma.Decimal | string;
  brokerProcessedPayment: boolean;
}): boolean {
  return (
    input.brokerProcessedPayment === true ||
    compareMoney(
      quantizeMoney(input.approvedAmount),
      CLAIM_LARGE_THRESHOLD_JOD,
    ) >= 0
  );
}

export interface SettlementView {
  estimatedLoss: string;
  approvedAmount: string | null;
  deductible: string | null;
  netSettlement: string | null;
  brokerProcessedPayment: boolean;
  approvedByUserId: string | null;
  secondApproverUserId: string | null;
  /** Re-derived from `approvedAmount` + `brokerProcessedPayment` (NOT
   * `Claim.isLargeClaim`). */
  secondApproverRequired: boolean;
  /** The four figures are recorded, the (any) required second approval is in,
   * and the `Claim` has reached `SETTLED`. */
  settled: boolean;
  /** Process 29 — when the client's receipt of the settlement payment was
   * confirmed (write-once). A `SETTLED` claim can only be closed once this is
   * set. */
  clientPaymentConfirmedAt: string | null;
  createdAt: Date;
}

/** Derive the Process 28 settlement sub-view from the `Settlement` row (or
 * null) and the claim status. Pure. */
export function deriveSettlementView(input: {
  status: string;
  settlement: {
    estimatedLoss: Prisma.Decimal;
    approvedAmount: Prisma.Decimal | null;
    deductible: Prisma.Decimal | null;
    netSettlement: Prisma.Decimal | null;
    brokerProcessedPayment: boolean;
    approvedByUserId: string | null;
    secondApproverUserId: string | null;
    clientPaymentConfirmedAt: Date | null;
    createdAt: Date;
  } | null;
}): SettlementView | null {
  const s = input.settlement;
  if (!s) return null;
  return {
    estimatedLoss: formatMoney(s.estimatedLoss),
    approvedAmount: s.approvedAmount ? formatMoney(s.approvedAmount) : null,
    deductible: s.deductible ? formatMoney(s.deductible) : null,
    netSettlement: s.netSettlement ? formatMoney(s.netSettlement) : null,
    brokerProcessedPayment: s.brokerProcessedPayment,
    approvedByUserId: s.approvedByUserId,
    secondApproverUserId: s.secondApproverUserId,
    secondApproverRequired: s.approvedAmount
      ? isSecondApproverRequired({
          approvedAmount: s.approvedAmount,
          brokerProcessedPayment: s.brokerProcessedPayment,
        })
      : false,
    settled: input.status === 'SETTLED' || input.status === 'CLOSED',
    clientPaymentConfirmedAt: s.clientPaymentConfirmedAt
      ? s.clientPaymentConfirmedAt.toISOString()
      : null,
    createdAt: s.createdAt,
  };
}

/**
 * CREATE / APPROVE audit `afterValue` for a `Settlement`. Financial
 * accountability data — the four figures ARE the point (an insurer dispute
 * reads this row), recorded as fixed 3dp strings; ids + the flags; never any
 * claim narrative (`sensitive-data-handling.md` — same treatment as the #22
 * endorsement money snapshots).
 */
export function settlementAuditSnapshot(row: {
  settlementId: string;
  claimId: string;
  estimatedLoss: Prisma.Decimal;
  approvedAmount: Prisma.Decimal | null;
  deductible: Prisma.Decimal | null;
  netSettlement: Prisma.Decimal | null;
  brokerProcessedPayment: boolean;
  approvedByUserId: string | null;
  secondApproverUserId: string | null;
  secondApproverRequired: boolean;
}): Prisma.InputJsonObject {
  return {
    settlementId: row.settlementId,
    claimId: row.claimId,
    estimatedLoss: formatMoney(row.estimatedLoss),
    approvedAmount: row.approvedAmount ? formatMoney(row.approvedAmount) : null,
    deductible: row.deductible ? formatMoney(row.deductible) : null,
    netSettlement: row.netSettlement ? formatMoney(row.netSettlement) : null,
    brokerProcessedPayment: row.brokerProcessedPayment,
    approvedByUserId: row.approvedByUserId,
    secondApproverUserId: row.secondApproverUserId,
    secondApproverRequired: row.secondApproverRequired,
  };
}
