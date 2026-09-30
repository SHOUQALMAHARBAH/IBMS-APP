import type { CombinedDutyActOnRecord } from "../../components/ui/CombinedDutyOnRecord";
// Part 10.1 / Process #40 — talks to apps/api's rbac module
// (access-recertification.controller.ts). Mirrors lib/auth/auth-api.ts's
// conventions (thin typed wrappers over apiGet/apiPost).

import { apiGet, apiPost } from "../auth/api-client";

export type RecertificationDecision = "confirmed" | "revoked" | "changed";

export interface RecertificationItem {
  id: string;
  cycleId: string;
  cycleLabel: string;
  subjectUserId: string;
  subjectFullName: string;
  subjectEmail: string;
  subjectRoles: string[];
  /** Whether this subject can administer users (`user.manage`), resolved
   *  server-side. The table badges it as Part 5.1's "the administrator is NOT
   *  exempt". Not derivable here: role names are office-chosen, so comparing
   *  against 'SYSTEM_SECURITY_ADMINISTRATOR' would stop badging an office's own
   *  administrator role. */
  subjectIsUserAdministrator: boolean;
  reviewerUserId: string;
  /** WHO reviewed this subject, by name. Near-redundant on the reviewer's own queue — every row
   *  is theirs — and the whole point on the administrator record, where "was this administrator
   *  reviewed" is only half the question. */
  reviewerFullName: string;
  decision: RecertificationDecision | null;
  reviewedAt: string | null;
  /**
   * Part 4 step 5 — TWO acts, and NOT two pairs. The second column exists precisely so these stay
   * separate facts:
   *
   *   `arrangementCombinedDutyAct` — she was SET TO review her own access, written when the cycle OPENED.
   *                                 In a one-person office this is the only way a cycle can start, so it
   *                                 says the office had nobody else — not that anybody signed off.
   *   `decisionCombinedDutyAct`    — she DID review it, dated to the review. EVIDENCE, and the act a
   *                                 reader is actually looking for.
   *
   * Never collapse them: that would report a cycle which merely could not do better as if somebody had
   * signed off on their own access.
   */
  arrangementCombinedDutyAct: CombinedDutyActOnRecord | null;
  decisionCombinedDutyAct: CombinedDutyActOnRecord | null;
  createdAt: string;
}

export interface RecertificationCycle {
  id: string;
  cycleLabel: string;
  startedAt: string;
  dueAt: string;
  closedAt: string | null;
}

// POST .../decision returns the raw AccessRecertificationItem (see
// AccessRecertificationService#decide) — NOT the enriched shape GET
// .../items returns. Deliberately narrower than RecertificationItem so a
// caller can't assume fields (subjectFullName, subjectRoles, ...) that
// genuinely aren't there — that mismatch used to crash the review table
// after a decision, since RecertificationItemsTable reads
// item.subjectRoles.includes(...) on every row.
export interface RecertificationDecisionResult {
  id: string;
  cycleId: string;
  subjectUserId: string;
  reviewerUserId: string;
  decision: RecertificationDecision;
  reviewedAt: string | null;
  createdAt: string;
}

export function listMyRecertificationItems(): Promise<RecertificationItem[]> {
  return apiGet("/access-recertification/items");
}

/**
 * The office's cycles, newest first — gated on EITHER recertification code.
 *
 * Exists so `listAdminRecertificationItems` can be addressed: before it, the only source of a
 * cycle id was the start-cycle response, so the administrator review record was readable for a
 * cycle you had just started in this session and for no earlier one.
 */
export function listRecertificationCycles(): Promise<RecertificationCycle[]> {
  return apiGet("/access-recertification/cycles");
}

/**
 * The administrator subjects in one cycle — Part 5.1's "the administrator is NOT exempt from
 * recertification of its own access", which makes this the record proving they were covered.
 *
 * Returns the same ENRICHED shape the reviewer's queue does. It used to return raw rows, so a
 * screen would have rendered uuids for both the subject and the reviewer.
 */
export function listAdminRecertificationItems(
  cycleId: string,
): Promise<RecertificationItem[]> {
  return apiGet(
    `/access-recertification/cycles/${encodeURIComponent(cycleId)}/admin-items`,
  );
}

export function startRecertificationCycle(input: {
  cycleLabel: string;
  dueAt?: string;
  /**
   * Needed only when somebody in the office has nobody but themselves to review their access.
   *
   * Sent on the CYCLE rather than per subject because that is where this pair's self-review is decided:
   * the reviewer is assigned when the cycle opens. Every other office sends nothing and the cycle behaves
   * exactly as before — a subject with no other reviewer is skipped, as it always was.
   */
  combinedDutyReason?: string;
}): Promise<RecertificationCycle> {
  return apiPost("/access-recertification/cycles", input);
}

export function decideRecertificationItem(
  itemId: string,
  decision: RecertificationDecision,
  /** Required only when the reviewer IS the subject — the self-review the cycle already declared. Asked
   *  again here rather than carried forward, so the flagged line in the self-approval report is dated to
   *  the review instead of the arrangement. */
  combinedDutyReason?: string,
): Promise<RecertificationDecisionResult> {
  return apiPost(`/access-recertification/items/${itemId}/decision`, {
    decision,
    ...(combinedDutyReason ? { combinedDutyReason } : {}),
  });
}
