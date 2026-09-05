// Process 17 — Client Decision Handling (backlog Part C #17, Domain B). Talks
// to apps/api's client-decision module (client-decision.controller.ts):
// records the client's single decision on a sent recommendation and reports
// which of the three Opportunity routes it takes.

import { apiGet, apiPost } from '../auth/api-client';

export type ClientDecisionType =
  | 'ACCEPT'
  | 'REJECT'
  | 'REQUEST_FURTHER_NEGOTIATION'
  | 'REQUEST_ALTERNATIVE_OPTIONS'
  | 'REQUEST_PRICE_REDUCTION'
  | 'REQUEST_COVERAGE_INCREASE';

export type ClientDecisionRoute = 'PLACEMENT' | 'CLOSED_LOST' | 'RENEGOTIATE';

export type EvidenceType = 'signature' | 'e-signature' | 'email_confirmation';

export const DECISION_TYPE_OPTIONS: {
  value: ClientDecisionType;
  label: string;
}[] = [
  { value: 'ACCEPT', label: 'Accept as recommended' },
  { value: 'REJECT', label: 'Reject' },
  { value: 'REQUEST_FURTHER_NEGOTIATION', label: 'Request further negotiation' },
  { value: 'REQUEST_ALTERNATIVE_OPTIONS', label: 'Request alternative options' },
  { value: 'REQUEST_PRICE_REDUCTION', label: 'Request price reduction' },
  { value: 'REQUEST_COVERAGE_INCREASE', label: 'Request coverage increase' },
];

export const EVIDENCE_TYPE_OPTIONS: { value: EvidenceType; label: string }[] = [
  { value: 'e-signature', label: 'E-signature' },
  { value: 'signature', label: 'Wet signature' },
  { value: 'email_confirmation', label: 'Email confirmation' },
];

export interface ClientDecision {
  id: string;
  opportunityId: string;
  customerId: string;
  decision: ClientDecisionType;
  route: ClientDecisionRoute;
  routeLabel: string;
  evidenceType: string | null;
  evidenceRef: string | null;
  notes: string | null;
  capturedByUserId: string | null;
  decidedAt: string;
  opportunityStatus: string;
  routingComplete: boolean;
}

export interface CaptureClientDecisionInput {
  opportunityId: string;
  decision: ClientDecisionType;
  evidenceType: EvidenceType;
  evidenceRef: string;
  notes?: string;
}

export function listClientDecisionsForOpportunity(
  opportunityId: string,
): Promise<ClientDecision[]> {
  return apiGet(
    `/client-decisions?opportunityId=${encodeURIComponent(opportunityId)}`,
  );
}

export function captureClientDecision(
  input: CaptureClientDecisionInput,
): Promise<ClientDecision> {
  return apiPost('/client-decisions', input);
}
