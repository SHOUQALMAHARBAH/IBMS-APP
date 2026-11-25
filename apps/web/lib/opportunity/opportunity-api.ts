// Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). Talks
// to apps/api's opportunity module (opportunity.controller.ts). The minimal
// Opportunity parent an RFQ hangs off — created from a FINALIZED Insurance
// Program, then list/read only. Mirrors lib/insurance-program/
// insurance-program-api.ts's conventions.

import { apiGet, apiPatch, apiPost } from '../auth/api-client';
import type { Paginated } from '../api/paginated';

export type OpportunityStatus =
  | 'NEEDS_CONFIRMED'
  | 'RFQ_ISSUED'
  | 'QUOTES_RECEIVED'
  | 'COMPARISON_BUILT'
  | 'RECOMMENDATION_DRAFTED'
  | 'SENT_TO_CLIENT'
  | 'CLIENT_DECISION'
  | 'PLACEMENT'
  | 'RENEGOTIATE'
  | 'CLOSED_LOST';

export interface Opportunity {
  id: string;
  customerId: string;
  insuranceProgramId: string | null;
  isRenewal: boolean;
  status: OpportunityStatus;
  /** Part C #16 — the configurable premium threshold above which the broker
   * recommendation needs senior-officer approval. Decimal string or null. */
  targetPremiumThreshold: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityContext {
  insuranceProgramId: string | null;
  customerId: string;
}

export interface OpportunityWithContext extends Opportunity {
  context: OpportunityContext;
}

/**
 * The DETAIL read's context, which carries the two names its title is made of (decision 163
 * ruling 1). Separate from `OpportunityContext` because `createOpportunity` and
 * `setTargetPremiumThreshold` return the narrow one — and both callers discard the body, so a
 * nullable pair on the shared type would only add a branch that renders a uuid again.
 */
export interface OpportunityDetailContext extends OpportunityContext {
  customerLegalName: string;
  /** The programme's own name, null exactly when `insuranceProgramId` is. */
  insuranceProgramName: string | null;
}

export interface OpportunityWithDetailContext extends Opportunity {
  context: OpportunityDetailContext;
}

export function createOpportunity(
  insuranceProgramId: string,
): Promise<OpportunityWithContext> {
  return apiPost('/opportunities', { insuranceProgramId });
}

/** 🔴 OWNER DECISION 150 RULING 1 — every list row names its customer, because a reader who
 *  arrived from the sidebar has none in hand. The customer-scoped branch carries it too, so
 *  there is one row shape rather than one per branch. */
export interface OpportunityListRow extends Opportunity {
  customer: { id: string; legalName: string };
}

/** One customer's opportunities. Unwrapped to an array so this function keeps the shape its
 *  callers have always had — the server's envelope is one shape per ENDPOINT, not per branch. */
export async function listOpportunities(
  customerId: string,
): Promise<OpportunityListRow[]> {
  const page: Paginated<OpportunityListRow> = await apiGet(
    `/opportunities?customerId=${encodeURIComponent(customerId)}`,
  );
  return page.items;
}

/**
 * 🔴 OWNER DECISION 150 RULING 1 — THE BOOK-WIDE LIST.
 *
 * With no customer scope the API returns what THIS caller may see: the whole book for a holder
 * of `customer-file.all-owners.read` (Placement / Manager / Executive), and only opportunities
 * on customers they own for anyone else. ⛔ The filtering happens in the QUERY, so the page
 * window narrows matching rows rather than rows scanned.
 */
export function listAllOpportunities(
  params: { search?: string; page?: number } = {},
): Promise<Paginated<OpportunityListRow>> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  // Sent only past the first page, so the common request keeps the URL it has always had and
  // the server's own default decides the size.
  if (params.page) qs.set('page', String(params.page));
  const suffix = qs.toString();
  return apiGet(`/opportunities${suffix ? `?${suffix}` : ''}`);
}

export function getOpportunity(
  id: string,
): Promise<OpportunityWithDetailContext> {
  return apiGet(`/opportunities/${id}`);
}

/** Part C #16 — set (`"250000.000"`) or clear (`null`) the senior-officer
 * approval threshold. Manager/Executive only. */
export function setTargetPremiumThreshold(
  id: string,
  targetPremiumThreshold: string | null,
): Promise<OpportunityWithContext> {
  return apiPatch(`/opportunities/${id}/target-premium-threshold`, {
    targetPremiumThreshold,
  });
}
