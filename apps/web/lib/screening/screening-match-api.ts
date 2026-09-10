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
