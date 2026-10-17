import { apiGet, apiPost } from "../auth/api-client";

// Process 49 — the sanctions match review queue. Fuzzy name matching
// deliberately over-fires (transliteration variants, extra middle names), so
// every candidate is adjudicated by a Compliance Officer. Nothing in the
// system blocks a customer on a match; this queue is the decision point.

export type ScreeningMatchStatus = "pending" | "cleared" | "confirmed";

export interface ScreeningMatch {
  id: string;
  kycRecordId: string;
  customerId: string;
  customerLegalName: string;
  customerStatus: string;
  kycStatus: string;
  isEdd: boolean;
  /** The name that matched — not always the customer's own, since screening
   * covers ultimate beneficial owners too. */
  subjectName: string;
  /** `exact` (identical after canonicalisation) or `fuzzy` (the list entry's
   * name is contained in the subject's). */
  matchType: string;
  status: ScreeningMatchStatus;
  detectedAt: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  listSource: string;
  listEntryName: string;
  listEntryRemarks: string | null;
  /** The matched entry has since dropped off the source list. The decision
   * and its written reason stand; the entry cannot be re-checked. */
  listEntryDelisted: boolean;

  /* THE CASE WORKFLOW. `status` above is the DECISION; this is the workflow
   * around it, and the API refuses a decision unless the case is UNDER_REVIEW
   * or ESCALATED — so until these arrived, the only control this screen had
   * was one that refused every time (IMPROVEMENTS § 1.62). */
  caseStatus: ScreeningCaseStatus;
  assignedToUserId: string | null;
  assignedAt: string | null;
  reviewStartedAt: string | null;
  escalatedToUserId: string | null;
  escalatedAt: string | null;
  escalationReason: string | null;
}

/** The workflow states, mirroring `ScreeningCaseStatus` in the schema. */
export const SCREENING_CASE_STATUSES = [
  "OPEN",
  "ASSIGNED",
  "UNDER_REVIEW",
  "ESCALATED",
  "CLOSED",
] as const;
export type ScreeningCaseStatus = (typeof SCREENING_CASE_STATUSES)[number];

/** The states a decision may be recorded from — `DECIDABLE_FROM` on the API
 * side. Mirrored so the screen does not offer a decision it knows will be
 * refused; the server stays the authority. */
export function caseCanBeDecided(status: ScreeningCaseStatus): boolean {
  return status === "UNDER_REVIEW" || status === "ESCALATED";
}

export interface ScreeningCaseNote {
  id: string;
  note: string;
  authorUserId: string;
  createdAt: string;
}

/** The case view: the match row plus its working notes, oldest first. */
export interface ScreeningCase extends ScreeningMatch {
  notes: ScreeningCaseNote[];
}

export interface ScreeningReviewer {
  id: string;
  fullName: string;
}

export function listScreeningMatches(
  status: ScreeningMatchStatus = "pending",
): Promise<ScreeningMatch[]> {
  return apiGet(`/screening/matches?status=${encodeURIComponent(status)}`);
}

/** `watchlistReady` false = the synced sanctions cache is EMPTY, so an empty
 * queue means "nothing was ever checked", not "nothing matched". */
export function getPendingMatchCount(): Promise<{
  pending: number;
  watchlistReady: boolean;
}> {
  return apiGet("/screening/matches/pending-count");
}

/** `cleared` = false positive. `confirmed` = a true match; the customer stays
 * escalated. Both require a written reason — it is the record a regulator
 * asks for when questioning why a name that matched a sanctions list was let
 * through. A recorded decision is final here. */
export function reviewScreeningMatch(
  id: string,
  decision: "cleared" | "confirmed",
  reviewReason: string,
): Promise<ScreeningMatch> {
  return apiPost(`/screening/matches/${encodeURIComponent(id)}/review`, {
    decision,
    reviewReason,
  });
}

/*
 * THE CASE WORKFLOW ROUTES — five of them, and none had a web caller
 * (IMPROVEMENTS § 1.44, § 1.62).
 *
 * The consequence was worse than five missing conveniences. `decide()` refuses
 * unless the case is UNDER_REVIEW or ESCALATED, and the only ways there are
 * `assign` then `start-review`, or `escalate`. With none of them callable, every
 * match sat at OPEN forever and the one control this screen did offer — the
 * decision — returned 422 every single time, telling the officer to "assign it
 * and start the review" with nothing in the application able to do either.
 *
 * A full api e2e (`screening-case-lifecycle.e2e-spec.ts`) walks the entire
 * lifecycle through HTTP, which is exactly why this survived: every gate was
 * green on a workflow no user could reach.
 */

/** Who a case may be assigned to: active holders of `sanctions-pep.screen`,
 * access window respected. Its own endpoint rather than the admin user list,
 * which a Compliance Officer cannot read. */
export function listScreeningReviewers(): Promise<ScreeningReviewer[]> {
  return apiGet("/screening/reviewers");
}

/** The match plus its working notes — the evidence trail the AMLU requires
 * kept: "the entity must keep the verification mechanism and actions taken
 * regarding the case in internal records." */
export function getScreeningCase(id: string): Promise<ScreeningCase> {
  return apiGet(`/screening/matches/${encodeURIComponent(id)}/case`);
}

/** Assign or re-assign. Re-assignment is legitimate — leave, workload, a
 * conflict of interest — so ASSIGNED -> ASSIGNED is allowed by the API. */
export function assignScreeningCase(
  id: string,
  assigneeUserId: string,
): Promise<ScreeningMatch> {
  return apiPost(`/screening/matches/${encodeURIComponent(id)}/assign`, {
    assigneeUserId,
  });
}

/** The assigned reviewer picks the case up. A separate step from assignment on
 * purpose: it is the difference between a case somebody is working and one
 * sitting in their queue untouched, which is what an SLA is actually about. */
export function startScreeningReview(id: string): Promise<ScreeningMatch> {
  return apiPost(`/screening/matches/${encodeURIComponent(id)}/start-review`, {});
}

/** The floors the DTOs enforce. Mirrored so the screen never sends a request it
 * already knows will be refused; the server stays the authority. An escalation
 * with no stated basis is indistinguishable from passing the work along. */
export const ESCALATION_REASON_MIN_LENGTH = 10;
export const CASE_NOTE_MIN_LENGTH = 1;

export function escalationReasonIsValid(reason: string): boolean {
  return reason.trim().length >= ESCALATION_REASON_MIN_LENGTH;
}
export function caseNoteIsValid(note: string): boolean {
  return note.trim().length >= CASE_NOTE_MIN_LENGTH;
}

/** Hand the case up, with a stated reason. */
export function escalateScreeningCase(
  id: string,
  toUserId: string,
  reason: string,
): Promise<ScreeningMatch> {
  return apiPost(`/screening/matches/${encodeURIComponent(id)}/escalate`, {
    toUserId,
    reason: reason.trim(),
  });
}

/** A working note. This is the "actions taken regarding the case" half of the
 * AMLU retention requirement, and it is the part a decision reason alone cannot
 * carry — what was checked, against which identifiers, and what it showed. */
export function addScreeningCaseNote(
  id: string,
  note: string,
): Promise<ScreeningCaseNote> {
  return apiPost(`/screening/matches/${encodeURIComponent(id)}/notes`, {
    note: note.trim(),
  });
}
