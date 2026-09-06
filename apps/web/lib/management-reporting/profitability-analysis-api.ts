// Process 63 — Profitability Analysis (backlog Part C #63, Domain G). Reads
// apps/api's GET /profitability-analysis: commission income vs. cost-to-serve
// per line/segment. profitability-analysis.view (already pre-seeded for
// Executive Management / Finance — NOT Branch/Department Manager, unlike
// #58-62).

import { apiGet } from '../auth/api-client';

export interface ProfitabilityBreakdownRow {
  key: string;
  commissionIncomeJod: string;
  costToServeJod: string;
  netProfitabilityJod: string;
  policyCount: number;
  claimCount: number;
}

export interface ProfitabilityAnalysisSummary {
  generatedAt: string;
  byLine: ProfitabilityBreakdownRow[];
  bySegment: ProfitabilityBreakdownRow[];
  totals: Omit<ProfitabilityBreakdownRow, 'key'>;
}

export function getProfitabilityAnalysis(): Promise<ProfitabilityAnalysisSummary> {
  return apiGet('/profitability-analysis');
}
