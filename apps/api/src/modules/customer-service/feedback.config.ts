import type { Prisma } from '@ibms/db';

/**
 * Process 45 — Customer Feedback (backlog Part C #45, Domain E). The pure,
 * deterministic core: the `context` domain, the score bound, and the view /
 * audit-snapshot shapes.
 *
 * `CustomerFeedback` pre-existed (Part 4 core schema) and needs no widening —
 * `id`, `customerId`, `context`, `score`, `comments`, `submittedAt` are
 * already everything a satisfaction-survey log needs. Not a
 * `WorkflowTransitionService` entity, no maker/checker, no `SlaTimer` — a
 * factual log, the `Interaction` #10 shape (create + read only).
 *
 * `ibms-brain/meta/context/customer-service-lifecycle.md` § "Customer
 * Feedback (Process 45)".
 */

/** `comments` is customer-typed free text solicited immediately after a claim
 * settlement, a policy issuance, or a renewal — precisely the moment a
 * dissatisfied customer is most likely to write something like "you still
 * haven't refunded my JOD to account 0123456789" (`sensitive-data-handling.md`
 * § "What triggers this rule" names "a claim note" as exactly this scenario).
 * Unlike CRM's `Interaction.summary` (a staff-authored note on an arbitrary
 * touchpoint), this field is book-wide readable and Confidential-tier, so it
 * carries the shared guard — same as #41 / #42 / #44's free-text fields. */
export {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
} from '../../common/dto.util';

/** The three touchpoints the model's own doc comment names — post-issuance,
 * post-claim, post-renewal satisfaction surveys. */
export const FEEDBACK_CONTEXTS = [
  'post_issuance',
  'post_claim',
  'post_renewal',
] as const;
export type FeedbackContext = (typeof FEEDBACK_CONTEXTS)[number];

export function isFeedbackContext(v: string): v is FeedbackContext {
  return (FEEDBACK_CONTEXTS as readonly string[]).includes(v);
}

/** A 5-point satisfaction scale. Part 3.8 names no scale — DRAFTED /
 * UNSOURCED, the same status as `CLAIM_LARGE_THRESHOLD_JOD` (#23) and the
 * #41 / #42 SLA figures; replace with a sourced figure if a CX / Compliance
 * SOP supplies one. */
export const FEEDBACK_SCORE_MIN = 1;
export const FEEDBACK_SCORE_MAX = 5;

/** Cap on a book-wide `CustomerFeedback` list. */
export const FEEDBACK_READ_LIMIT = 5000;

export interface FeedbackRow {
  id: string;
  customerId: string;
  context: string;
  score: number | null;
  comments: string | null;
  submittedAt: Date;
}

export interface FeedbackView {
  id: string;
  customerId: string;
  context: string;
  score: number | null;
  comments: string | null;
  submittedAt: string;
}

export function deriveFeedbackView(row: FeedbackRow): FeedbackView {
  return {
    id: row.id,
    customerId: row.customerId,
    context: row.context,
    score: row.score,
    comments: row.comments,
    submittedAt: row.submittedAt.toISOString(),
  };
}

/** CREATE audit `afterValue` — ids + `context` + `score` + `submittedAt`.
 * `comments` is **never** included, even though it is only Confidential tier
 * (not personal data by policy) — the CRM `Interaction.summary` precedent
 * (`crm.service.ts` `logInteraction`), not #41 / #42's business-action notes:
 * feedback `comments` is the customer's own subjective reflection, closer in
 * kind to an Interaction summary than to a "what was done / why" operational
 * note, so it is treated the same conservative way. (This is the *only*
 * divergence from #41 / #42 / #44's precedent — the `NO_FULL_ACCOUNT_NUMBER`
 * input guard above still applies, unlike the audit-row exclusion.) */
export function feedbackAuditSnapshot(input: {
  feedbackId: string;
  customerId: string;
  context: string;
  score: number | null;
  submittedAt: Date;
}): Prisma.InputJsonObject {
  return {
    feedbackId: input.feedbackId,
    customerId: input.customerId,
    context: input.context,
    score: input.score,
    submittedAt: input.submittedAt.toISOString(),
  };
}
