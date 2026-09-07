// Process 72-73 — Business Continuity & Disaster Recovery (backlog Part C
// #72-73, Domain H). Calls apps/api's /bcp-dr-plans routes. bcp-dr.manage
// (already pre-seeded).

import { apiGet, apiPatch, apiPost } from '../auth/api-client';

export const BCP_DR_SCENARIOS = [
  'system_outage',
  'office_site_loss',
  'cyberattack_ransomware',
  'key_staff_unavailability',
  'insurer_service_interruption',
] as const;
export type BcpDrScenario = (typeof BCP_DR_SCENARIOS)[number];

export interface BcpDrPlan {
  id: string;
  scenario: BcpDrScenario;
  planDocumentId: string | null;
  rtoHours: number | null;
  rpoHours: number | null;
  lastTestedAt: string | null;
  nextTestDueAt: string | null;
}

export interface ScenarioCoverage {
  scenario: BcpDrScenario;
  hasPlan: boolean;
  plans: BcpDrPlan[];
}

export function listBcpDrPlans(scenario?: string): Promise<BcpDrPlan[]> {
  return apiGet(
    scenario ? `/bcp-dr-plans?scenario=${encodeURIComponent(scenario)}` : '/bcp-dr-plans',
  );
}

export function getBcpDrPlanCoverage(): Promise<ScenarioCoverage[]> {
  return apiGet('/bcp-dr-plans/coverage');
}

export function createBcpDrPlan(input: {
  scenario: BcpDrScenario;
  planDocumentId?: string;
  rtoHours?: number;
  rpoHours?: number;
}): Promise<BcpDrPlan> {
  return apiPost('/bcp-dr-plans', input);
}

export function updateBcpDrPlan(
  id: string,
  input: { planDocumentId?: string; rtoHours?: number; rpoHours?: number },
): Promise<BcpDrPlan> {
  return apiPatch(`/bcp-dr-plans/${id}`, input);
}

export function recordBcpDrPlanTest(
  id: string,
  nextTestDueAt: string,
): Promise<BcpDrPlan> {
  return apiPost(`/bcp-dr-plans/${id}/record-test`, { nextTestDueAt });
}
