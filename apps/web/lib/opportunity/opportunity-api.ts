// Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). Talks
// to apps/api's opportunity module (opportunity.controller.ts). The minimal
// Opportunity parent an RFQ hangs off — created from a FINALIZED Insurance
// Program, then list/read only. Mirrors lib/insurance-program/
// insurance-program-api.ts's conventions.

import { apiGet, apiPatch, apiPost } from '../auth/api-client';

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

export function createOpportunity(
  insuranceProgramId: string,
): Promise<OpportunityWithContext> {
  return apiPost('/opportunities', { insuranceProgramId });
}

export function listOpportunities(customerId: string): Promise<Opportunity[]> {
  return apiGet(`/opportunities?customerId=${encodeURIComponent(customerId)}`);
}

export function getOpportunity(id: string): Promise<OpportunityWithContext> {
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
