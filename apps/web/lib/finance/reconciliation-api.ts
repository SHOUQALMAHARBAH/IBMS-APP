// Process 39 — Bank Reconciliation (backlog Part C #39, Domain D). Reads
// apps/api's /reconciliation-exceptions endpoints: run the insurer-statement-
// vs-broker-record variance check (reconciliation-exception.investigate), then
// investigate and resolve each ReconciliationException
// (reconciliation-exception.resolve to close).

import { apiGet, apiPost } from '../auth/api-client';

export interface ReconciliationException {
  id: string;
  invoiceId: string | null;
  insurerStatementAmount: string;
  brokerRecordAmount: string;
  varianceAmount: string;
  status: string;
  isResolved: boolean;
  raisedByUserId: string | null;
  investigatedByUserId: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface DetectLineResult {
  invoiceId: string;
  outcome: string;
  varianceAmount?: string;
  exceptionId?: string;
  invoiceStatus?: string;
}

export interface DetectResult {
  lineCount: number;
  reconciled: number;
  exceptionsRaised: number;
  results: DetectLineResult[];
}

export function listReconciliationExceptions(
  opts: { invoiceId?: string; status?: string } = {},
): Promise<ReconciliationException[]> {
  const params = new URLSearchParams();
  if (opts.invoiceId) params.set('invoiceId', opts.invoiceId);
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  return apiGet(`/reconciliation-exceptions${qs ? `?${qs}` : ''}`);
}

export function detectReconciliation(
  lines: { invoiceId: string; insurerStatementAmount: string }[],
): Promise<DetectResult> {
  return apiPost('/reconciliation-exceptions/detect', { lines });
}

export function investigateReconciliationException(
  id: string,
): Promise<ReconciliationException> {
  return apiPost(`/reconciliation-exceptions/${id}/investigate`, {});
}

export function resolveReconciliationException(
  id: string,
  body: { resolutionNote: string; resumeInvoiceAs?: string },
): Promise<ReconciliationException> {
  return apiPost(`/reconciliation-exceptions/${id}/resolve`, body);
}
