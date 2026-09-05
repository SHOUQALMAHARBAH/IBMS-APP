import type { Prisma } from '@ibms/db';

/**
 * Process 51/Part 7.1 — the CBJ regulatory compliance calendar (backlog
 * Part C #51's second checkbox: "A compliance calendar of regulatory
 * obligations with owner, due date, and evidence-of-submission tracking").
 * The pure, deterministic core: the overdue derivation and the view / audit
 * snapshot shapes.
 *
 * `ComplianceCalendarItem` (Part 7.1 core schema) pre-existed and needs no
 * widening — `obligationName`/`ownerUserId`/`dueDate`/
 * `evidenceOfSubmissionRef`/`submittedAt` already cover a one-off obligation
 * log. **No migration, no seed change** — `compliance-calendar.manage`
 * (`[COMPLIANCE_OFFICER]`) was pre-seeded ahead of time. Not a
 * `WorkflowTransitionService` entity, no maker/checker — a factual log, the
 * `CustomerFeedback`/#45 shape (create, one submission stamp, read).
 * Recurring obligations are modelled as a NEW row per cycle, not a
 * recurrence field on one row — the same per-instance shape `ServiceRequest`
 * (#41) and `RetentionCase` (#46) use, since the bare schema has nothing to
 * express a recurrence rule with.
 *
 * `ibms-brain/meta/context/regulatory-compliance.md`.
 */

/** Cap on a book-wide `ComplianceCalendarItem` list. */
export const COMPLIANCE_CALENDAR_READ_LIMIT = 5000;

export interface ComplianceCalendarItemRow {
  id: string;
  obligationName: string;
  ownerUserId: string;
  dueDate: Date;
  evidenceOfSubmissionRef: string | null;
  submittedAt: Date | null;
}

export interface ComplianceCalendarItemView {
  id: string;
  obligationName: string;
  ownerUserId: string;
  dueDate: string;
  evidenceOfSubmissionRef: string | null;
  submittedAt: string | null;
  isSubmitted: boolean;
  /** `submittedAt === null && dueDate < now` — a lightweight, derived
   * dashboard convenience (the `Policy.issuanceComplete` shape); not itself
   * a tracked `SlaTimer` deadline (the backlog names no statutory turnaround
   * for logging the calendar itself, only for the underlying filings it
   * tracks — a case-by-case matter, not a single sourced figure). */
  isOverdue: boolean;
}

export function deriveComplianceCalendarItemView(
  row: ComplianceCalendarItemRow,
  now: Date,
): ComplianceCalendarItemView {
  const isSubmitted = row.submittedAt !== null;
  return {
    id: row.id,
    obligationName: row.obligationName,
    ownerUserId: row.ownerUserId,
    dueDate: row.dueDate.toISOString(),
    evidenceOfSubmissionRef: row.evidenceOfSubmissionRef,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    isSubmitted,
    isOverdue: !isSubmitted && row.dueDate.getTime() < now.getTime(),
  };
}

/** CREATE/UPDATE audit `afterValue`. `obligationName` and
 * `evidenceOfSubmissionRef` are internal regulatory labels/reference ids
 * Compliance writes about the broker's own filings — not customer data, no
 * `NO_FULL_ACCOUNT_NUMBER` guard needed (the `BrokerLicense.
 * scopeOfAuthorization` reasoning) — included verbatim. */
export function complianceCalendarItemAuditSnapshot(
  input: ComplianceCalendarItemRow,
): Prisma.InputJsonObject {
  return {
    complianceCalendarItemId: input.id,
    obligationName: input.obligationName,
    ownerUserId: input.ownerUserId,
    dueDate: input.dueDate.toISOString(),
    evidenceOfSubmissionRef: input.evidenceOfSubmissionRef,
    submittedAt: input.submittedAt ? input.submittedAt.toISOString() : null,
  };
}
