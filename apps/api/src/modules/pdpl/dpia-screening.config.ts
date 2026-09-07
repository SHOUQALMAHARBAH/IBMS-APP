import type { DpiaOutcome, Prisma } from '@ibms/db';

export const DPIA_REVIEW_SLA_WORKFLOW = 'dpia_review';

/**
 * M10 — DPIA Screening (backlog Part D §5.1, Process #52; PRIV-SRS-01 M10).
 * The 5-question yes/no form. Any single "Yes" -> mandatory DPO review
 * within 5 business days (`dpia_review`, already registered in
 * `SLA_REGISTRY` with zero prior caller — this build is its first). An
 * all-"No" result auto-approves, subject only to an un-timed DPO spot-check
 * (no SLA — the backlog names a review DEADLINE only for the "any Yes"
 * path; a spot-check is a quality-assurance sample, not a per-record
 * statutory clock).
 *
 * `dpia.review` is the ONLY pre-seeded permission for this process
 * (DPO-only, `roles.ts`'s own DPO description: "owns ... simplified DPIA
 * decisions") — there is no separate "submit"/"screen" permission, so it
 * gates the WHOLE surface including `create()` (the #67/#69/#71/#74 "one
 * pre-seeded permission gates the whole CRUD" precedent) — a real,
 * documented scope limit: in a fuller build, whoever proposes a new
 * product/system/campaign would submit this form themselves.
 *
 * **`outcome` is a status-shaped enum column, but is NOT named `status`**,
 * so it cannot be registered in `WORKFLOW_TRANSITIONS`/driven by
 * `WorkflowTransitionService` — that engine's `WorkflowDelegate` interface
 * hardcodes reading a column literally called `status`
 * (`workflow-transitions.config.ts`). `escalateToFullDpia()` is therefore a
 * hand-written, status-conditional repository `updateMany` instead (the
 * `LegalHold.release()`/`RetentionScheduleItem.confirm()` shape) — the
 * SAME "never assign a workflow status directly, only through a dedicated
 * transition function" discipline `workflow-state-transitions.md` asks
 * for, just not routed through the generic engine because the column name
 * doesn't match its hardcoded contract.
 *
 * The only real state move is `DPO_REVIEW_REQUIRED -> ESCALATED_FULL_DPIA`
 * — a DPO's alternative to completing an ordinary review
 * (`dpoReviewedAt` stamped, `outcome` unchanged) for a "materially
 * high-risk case." No numeric Yes-count threshold is specified anywhere in
 * the backlog for what counts as "materially high-risk" — escalation is
 * therefore a manual DPO judgment call, never automatic, so as not to
 * invent an unsourced threshold. `recordReview()` and `escalateToFullDpia()`
 * are mutually exclusive, single-shot actions from `DPO_REVIEW_REQUIRED`
 * (each re-asserts both `dpoReviewedAt: null` AND `escalatedToFullDpiaAt:
 * null` in its own `where`).
 */
export function computeDpiaOutcome(answers: {
  qSensitiveData: boolean;
  qLargeScaleProcessing: boolean;
  qCrossBorderTransfer: boolean;
  qNewTechnologyMonitoring: boolean;
  qNewDigitalChannel: boolean;
}): Extract<DpiaOutcome, 'AUTO_APPROVED' | 'DPO_REVIEW_REQUIRED'> {
  const anyYes =
    answers.qSensitiveData ||
    answers.qLargeScaleProcessing ||
    answers.qCrossBorderTransfer ||
    answers.qNewTechnologyMonitoring ||
    answers.qNewDigitalChannel;
  return anyYes ? 'DPO_REVIEW_REQUIRED' : 'AUTO_APPROVED';
}

export interface DpiaScreeningRow {
  id: string;
  subjectDescription: string;
  qSensitiveData: boolean;
  qLargeScaleProcessing: boolean;
  qCrossBorderTransfer: boolean;
  qNewTechnologyMonitoring: boolean;
  qNewDigitalChannel: boolean;
  outcome: DpiaOutcome;
  dpoReviewDueAt: Date | null;
  dpoReviewedAt: Date | null;
  dpoSpotCheckedAt: Date | null;
  escalatedToFullDpiaAt: Date | null;
  createdAt: Date;
}

export interface DpiaScreeningView {
  id: string;
  subjectDescription: string;
  qSensitiveData: boolean;
  qLargeScaleProcessing: boolean;
  qCrossBorderTransfer: boolean;
  qNewTechnologyMonitoring: boolean;
  qNewDigitalChannel: boolean;
  outcome: DpiaOutcome;
  dpoReviewDueAt: string | null;
  dpoReviewedAt: string | null;
  dpoSpotCheckedAt: string | null;
  escalatedToFullDpiaAt: string | null;
  createdAt: string;
}

export function deriveDpiaScreeningView(
  row: DpiaScreeningRow,
): DpiaScreeningView {
  return {
    id: row.id,
    subjectDescription: row.subjectDescription,
    qSensitiveData: row.qSensitiveData,
    qLargeScaleProcessing: row.qLargeScaleProcessing,
    qCrossBorderTransfer: row.qCrossBorderTransfer,
    qNewTechnologyMonitoring: row.qNewTechnologyMonitoring,
    qNewDigitalChannel: row.qNewDigitalChannel,
    outcome: row.outcome,
    dpoReviewDueAt: row.dpoReviewDueAt
      ? row.dpoReviewDueAt.toISOString()
      : null,
    dpoReviewedAt: row.dpoReviewedAt ? row.dpoReviewedAt.toISOString() : null,
    dpoSpotCheckedAt: row.dpoSpotCheckedAt
      ? row.dpoSpotCheckedAt.toISOString()
      : null,
    escalatedToFullDpiaAt: row.escalatedToFullDpiaAt
      ? row.escalatedToFullDpiaAt.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function dpiaScreeningAuditSnapshot(
  row: DpiaScreeningRow,
): Prisma.InputJsonObject {
  return {
    dpiaScreeningId: row.id,
    subjectDescription: row.subjectDescription,
    outcome: row.outcome,
    qSensitiveData: row.qSensitiveData,
    qLargeScaleProcessing: row.qLargeScaleProcessing,
    qCrossBorderTransfer: row.qCrossBorderTransfer,
    qNewTechnologyMonitoring: row.qNewTechnologyMonitoring,
    qNewDigitalChannel: row.qNewDigitalChannel,
  };
}
