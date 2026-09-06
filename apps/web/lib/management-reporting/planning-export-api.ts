// Process 65 — Strategic Planning Inputs (backlog Part C #65, Domain G).
// Calls apps/api's POST /planning-export: composes portfolio (#62) + market
// (#60) data into one export payload. planning-export.generate (already
// pre-seeded — Executive Management ONLY, the narrowest Domain G grant).

import { apiPost } from '../auth/api-client';

export interface PlanningExportBreakdownRow {
  key: string;
  policyCount: number;
  totalIssuedPremiumJod: string;
}

export interface PlanningExportPortfolio {
  byLine: PlanningExportBreakdownRow[];
  byInsurer: PlanningExportBreakdownRow[];
  byClientSegment: PlanningExportBreakdownRow[];
  byGeography: PlanningExportBreakdownRow[];
}

export interface InsurerPerformanceScoreRow {
  id: string;
  insurerId: string;
  periodLabel: string;
  quoteResponseScore: string;
  claimsServiceScore: string;
  priceScore: string;
  serviceQualityScore: string;
  computedAt: string;
}

export interface PlanningExportSummary {
  generatedAt: string;
  periodLabel: string;
  portfolio: PlanningExportPortfolio;
  market: InsurerPerformanceScoreRow[];
}

export function generatePlanningExport(
  periodLabel?: string,
): Promise<PlanningExportSummary> {
  return apiPost('/planning-export', periodLabel ? { periodLabel } : {});
}
