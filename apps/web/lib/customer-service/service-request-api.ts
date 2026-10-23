// Process 41 — Customer Requests (backlog Part C #41, Domain E). Reads apps/api's
// /service-requests endpoints: log a customer service request (certificate /
// copy / change / other), assign it, start it, and close it (fulfil / cancel).
// Its fulfilment is tracked against an SLA timer. `service-request.manage`
// (Sales, Manager).

import { apiGet, apiPost } from '../auth/api-client';

export interface ServiceRequestSla {
  timerId: string;
  dueAt: string;
  escalatedAt: string | null;
  escalatedTo: string | null;
  resolvedAt: string | null;
  breached: boolean;
}

export interface ServiceRequest {
  id: string;
  customerId: string;
  /**
   * RULE 2 — WHO THE ROW IS ABOUT, resolved by the api. This column used to render the first
   * eight characters of a uuid, which identifies nobody.
   *
   * Hand-copied over HTTP where TypeScript cannot check it against the api's own view, which
   * is how the customer-import result panel broke — so it is asserted on the response body in
   * an api e2e, not only in a Playwright mock that supplies it itself.
   */
  customerName: string;
  policyId: string | null;
  requestType: string;
  detail: string | null;
  status: string;
  isClosed: boolean;
  raisedByUserId: string | null;
  assignedToUserId: string | null;
  fulfilledByUserId: string | null;
  outcomeNote: string | null;
  sla: ServiceRequestSla | null;
  createdAt: string;
  closedAt: string | null;
}

export function listServiceRequests(
  opts: { customerId?: string; status?: string; assignedToUserId?: string } = {},
): Promise<ServiceRequest[]> {
  const params = new URLSearchParams();
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.status) params.set('status', opts.status);
  if (opts.assignedToUserId)
    params.set('assignedToUserId', opts.assignedToUserId);
  const qs = params.toString();
  return apiGet(`/service-requests${qs ? `?${qs}` : ''}`);
}

export function createServiceRequest(body: {
  customerId: string;
  requestType: string;
  detail?: string;
  policyId?: string;
  assignedToUserId?: string;
}): Promise<ServiceRequest> {
  return apiPost('/service-requests', body);
}

export function startServiceRequest(id: string): Promise<ServiceRequest> {
  return apiPost(`/service-requests/${id}/start`, {});
}

export function assignServiceRequest(
  id: string,
  assignedToUserId: string,
): Promise<ServiceRequest> {
  return apiPost(`/service-requests/${id}/assign`, { assignedToUserId });
}

export function fulfilServiceRequest(
  id: string,
  outcomeNote: string,
): Promise<ServiceRequest> {
  return apiPost(`/service-requests/${id}/fulfil`, { outcomeNote });
}

export function cancelServiceRequest(
  id: string,
  outcomeNote: string,
): Promise<ServiceRequest> {
  return apiPost(`/service-requests/${id}/cancel`, { outcomeNote });
}
