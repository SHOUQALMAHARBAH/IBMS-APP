// Process 46 — Customer Retention (backlog Part C #46, Domain E — closes the
// domain). Reads apps/api's /retention-cases endpoints: opens automatically
// on renewal inactivity or lapse risk (nightly + on-demand sweep), or
// manually; close once resolved. `retention-case.manage` (Sales, Manager).

import { apiGet, apiPost } from '../auth/api-client';

export const RETENTION_CASE_REASONS = [
  'renewal_inactivity',
  'lapse_risk',
] as const;

export interface RetentionCase {
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
  reason: string;
  status: string;
  isClosed: boolean;
  createdAt: string;
  closedAt: string | null;
}

export interface RetentionSweepResult {
  scanned: number;
  openedRenewalInactivity: number;
  openedLapseRisk: number;
  failed: number;
}

export function listRetentionCases(
  opts: { customerId?: string; status?: string; reason?: string } = {},
): Promise<RetentionCase[]> {
  const params = new URLSearchParams();
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.status) params.set('status', opts.status);
  if (opts.reason) params.set('reason', opts.reason);
  const qs = params.toString();
  return apiGet(`/retention-cases${qs ? `?${qs}` : ''}`);
}

export function createRetentionCase(body: {
  customerId: string;
  reason: string;
}): Promise<RetentionCase> {
  return apiPost('/retention-cases', body);
}

export function closeRetentionCase(id: string): Promise<RetentionCase> {
  return apiPost(`/retention-cases/${id}/close`, {});
}

export function runRetentionSweep(): Promise<RetentionSweepResult> {
  return apiPost('/retention-cases/sweep', {});
}
