// Process 61 — Employee Performance (backlog Part C #61, Domain G). Reads/
// writes apps/api's /employee-performance (employee-performance.view,
// already pre-seeded for Branch/Department Manager, Executive Management —
// no new permission was needed for this process).

import { apiGet, apiPost } from '../auth/api-client';

export interface EmployeePerformanceRecord {
  id: string;
  employeeId: string;
  periodLabel: string;
  newClients: number | null;
  premiumWrittenJod: string | null;
  commissionEarnedJod: string | null;
  renewalRatePercent: string | null;
  crossSellRatePercent: string | null;
}

export interface ComputeEmployeePerformanceInput {
  employeeId: string;
  periodLabel?: string;
  periodStart?: string;
  periodEnd?: string;
}

export function computeEmployeePerformance(
  input: ComputeEmployeePerformanceInput,
): Promise<EmployeePerformanceRecord> {
  return apiPost('/employee-performance/compute', input);
}

export function listEmployeePerformance(filters: {
  employeeId?: string;
  periodLabel?: string;
  /** Part E Insurer & Employee Performance Dashboard (backlog #64)
   * addition — scopes to employees whose linked User.branchId matches. */
  branchId?: string;
}): Promise<EmployeePerformanceRecord[]> {
  const params = new URLSearchParams();
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  if (filters.periodLabel) params.set('periodLabel', filters.periodLabel);
  if (filters.branchId) params.set('branchId', filters.branchId);
  const qs = params.toString();
  return apiGet(`/employee-performance${qs ? `?${qs}` : ''}`);
}

export function getLatestEmployeePerformance(
  employeeId: string,
): Promise<EmployeePerformanceRecord> {
  return apiGet(`/employee-performance/${employeeId}/latest`);
}
