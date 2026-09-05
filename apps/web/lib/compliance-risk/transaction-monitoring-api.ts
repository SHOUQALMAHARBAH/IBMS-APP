// Process 48 — AML/CFT Transaction Monitoring (backlog Part C #48, Domain F
// — opens Compliance & Risk beyond KYC). Reads apps/api's
// /transaction-monitoring-alerts endpoints: a nightly + on-demand detection
// sweep over unusual payment patterns, plus a two-step
// escalate -> report-to-authority suspicious-activity path.
// `aml.monitor` / `aml.escalate` (Compliance).

import { apiGet, apiPost } from '../auth/api-client';

export const TRANSACTION_MONITORING_PATTERN_TYPES = [
  'large_premium_payment',
  'frequent_cancellations',
  'frequent_refunds',
  'third_party_payment_source',
  'other',
] as const;

export interface TransactionMonitoringAlert {
  id: string;
  customerId: string | null;
  patternType: string;
  detailText: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  detectedAt: string;
  escalatedToSuspiciousActivity: boolean;
  escalatedAt: string | null;
  reportedToAuthorityAt: string | null;
  status: string;
  isClosed: boolean;
  classification: string;
}

export interface TransactionMonitoringSweepResult {
  scanned: number;
  created: number;
  skippedExisting: number;
  failed: number;
}

export function listTransactionMonitoringAlerts(
  opts: {
    customerId?: string;
    patternType?: string;
    status?: string;
  } = {},
): Promise<TransactionMonitoringAlert[]> {
  const params = new URLSearchParams();
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.patternType) params.set('patternType', opts.patternType);
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  return apiGet(`/transaction-monitoring-alerts${qs ? `?${qs}` : ''}`);
}

export function createTransactionMonitoringAlert(body: {
  customerId?: string;
  patternType: string;
  detailText?: string;
}): Promise<TransactionMonitoringAlert> {
  return apiPost('/transaction-monitoring-alerts', body);
}

export function runTransactionMonitoringSweep(): Promise<TransactionMonitoringSweepResult> {
  return apiPost('/transaction-monitoring-alerts/detect', {});
}

export function escalateTransactionMonitoringAlert(
  id: string,
): Promise<TransactionMonitoringAlert> {
  return apiPost(`/transaction-monitoring-alerts/${id}/escalate`, {});
}

export function reportTransactionMonitoringAlertToAuthority(
  id: string,
): Promise<TransactionMonitoringAlert> {
  return apiPost(`/transaction-monitoring-alerts/${id}/report-to-authority`, {});
}

export function closeTransactionMonitoringAlert(
  id: string,
): Promise<TransactionMonitoringAlert> {
  return apiPost(`/transaction-monitoring-alerts/${id}/close`, {});
}
