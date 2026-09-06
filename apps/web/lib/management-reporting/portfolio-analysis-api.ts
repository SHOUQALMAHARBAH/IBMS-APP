// Process 62 — Portfolio Analysis (backlog Part C #62, Domain G). Reads
// apps/api's GET /portfolio-analysis: a live snapshot of the issued book by
// line/insurer/client segment/geography. portfolio-analysis.view (already
// pre-seeded for Branch/Department Manager, Executive Management).

import { apiGet } from '../auth/api-client';

export interface PortfolioBreakdownRow {
  key: string;
  policyCount: number;
  totalIssuedPremiumJod: string;
}

export interface PortfolioAnalysisSummary {
  generatedAt: string;
  byLine: PortfolioBreakdownRow[];
  byInsurer: PortfolioBreakdownRow[];
  byClientSegment: PortfolioBreakdownRow[];
  byGeography: PortfolioBreakdownRow[];
}

export function getPortfolioAnalysis(): Promise<PortfolioAnalysisSummary> {
  return apiGet('/portfolio-analysis');
}
