// Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). Talks
// to apps/api's rfq module (rfq.controller.ts + rfq-insurer.controller.ts).
// One RFQ per insurance line under an Opportunity, sent to a shortlist of
// insurers; each shortlisted insurer is tracked as an RFQInsurer submission.

import { apiGet, apiPost } from '../auth/api-client';

export type RfqInsurerStatus =
  | 'SENT'
  | 'VIEWED'
  | 'QUOTED'
  | 'DECLINED'
  | 'NO_RESPONSE';

/** The response statuses a caller may move a submission *to* (SENT is the
 * initial state, never a target). Keep in sync with
 * `RFQ_INSURER_TARGET_STATUSES` in
 * apps/api/src/modules/rfq/dto/transition-rfq-insurer.dto.ts. */
export const RFQ_INSURER_TARGET_STATUSES: readonly RfqInsurerStatus[] = [
  'VIEWED',
  'QUOTED',
  'DECLINED',
  'NO_RESPONSE',
];

export interface SelectableInsurer {
  id: string;
  name: string;
  nameAr: string | null;
  financialStrengthRating: string | null;
}

export interface RfqInsurerSubmission {
  id: string;
  rfqId: string;
  insurerId: string;
  status: RfqInsurerStatus;
  sentAt: string;
  respondedAt: string | null;
  followUpAlertSentAt: string | null;
  insurer: SelectableInsurer;
}

export interface Rfq {
  id: string;
  opportunityId: string;
  insuranceLine: string;
  issuedAt: string;
  followUpThresholdDays: number;
  issuedByUserId: string | null;
  insurerSubmissions: RfqInsurerSubmission[];
}

/** Process 12 — a broker<->insurer exchange on an RFQ: an insurer's query
 * (`INBOUND`) or the broker's answer / additional-information note
 * (`OUTBOUND`). */
export type CommunicationDirection = 'INBOUND' | 'OUTBOUND';

export interface RfqCommunication {
  id: string;
  rfqId: string;
  rfqInsurerId: string | null;
  direction: CommunicationDirection;
  channel: string;
  subject: string | null;
  body: string | null;
  loggedByUserId: string | null;
  sentAt: string;
  createdAt: string;
  rfqInsurer: {
    id: string;
    insurer: { id: string; name: string; nameAr: string | null };
  } | null;
}

export interface LogRfqCommunicationInput {
  direction: CommunicationDirection;
  channel: string;
  body: string;
  subject?: string;
  rfqInsurerId?: string;
  occurredAt?: string;
}

export interface CreateRfqInput {
  opportunityId: string;
  insuranceLine: string;
  insurerIds: string[];
  followUpThresholdDays?: number;
}

export function createRfq(input: CreateRfqInput): Promise<Rfq> {
  return apiPost('/rfqs', input);
}

export function listSelectableInsurers(): Promise<SelectableInsurer[]> {
  return apiGet('/rfqs/selectable-insurers');
}

export function listRfqs(
  scope: { opportunityId: string } | { customerId: string },
): Promise<Rfq[]> {
  const query =
    'opportunityId' in scope
      ? `opportunityId=${encodeURIComponent(scope.opportunityId)}`
      : `customerId=${encodeURIComponent(scope.customerId)}`;
  return apiGet(`/rfqs?${query}`);
}

export function getRfq(id: string): Promise<Rfq> {
  return apiGet(`/rfqs/${id}`);
}

export function addRfqInsurers(
  rfqId: string,
  insurerIds: string[],
): Promise<Rfq> {
  return apiPost(`/rfqs/${rfqId}/insurers`, { insurerIds });
}

export function transitionRfqInsurer(
  submissionId: string,
  toStatus: RfqInsurerStatus,
): Promise<RfqInsurerSubmission> {
  return apiPost(`/rfq-insurers/${submissionId}/transition`, { toStatus });
}

export function listRfqCommunications(
  rfqId: string,
): Promise<RfqCommunication[]> {
  return apiGet(`/rfqs/${rfqId}/communications`);
}

export function logRfqCommunication(
  rfqId: string,
  input: LogRfqCommunicationInput,
): Promise<RfqCommunication> {
  return apiPost(`/rfqs/${rfqId}/communications`, input);
}
