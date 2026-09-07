// Process 40 — Financial Reporting (backlog Part C #40, Domain D). Reads
// apps/api's GET /financial-report/summary: the consolidated "Financial
// Dashboard" — AR / ageing totals (#33), insurer AP totals (#34), a commission
// income roll-up (earned / paid / outstanding / reversed, by insurer), and a
// profitability section (written policies grouped by line / customer segment).
// `financial-report.view`.

import { apiGet } from '../auth/api-client';

export interface FinancialReportReceivables {
  outstandingTotal: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
  invoiceCount: number;
  customerCount: number;
}

export interface FinancialReportPayables {
  outstandingAmount: string;
  outstandingCount: number;
  remittedAmount: string;
  remittedCount: number;
  insurerCount: number;
}

export interface CommissionRollupFigures {
  earned: string;
  vat: string;
  gross: string;
  /** `earned − reversed` — commission income recognised after clawbacks. */
  netEarned: string;
  paid: string;
  reversed: string;
  /** `Σ max(0, amount − paid − reversed)` — never negative. */
  outstanding: string;
  entryCount: number;
}

export interface CommissionRollupInsurerRow extends CommissionRollupFigures {
  insurerId: string;
  insurerName: string;
}

export interface CommissionRollup extends CommissionRollupFigures {
  byInsurer: CommissionRollupInsurerRow[];
}

export interface ProfitabilityRow {
  key: string;
  label: string;
  premiumWritten: string;
  claimsPaid: string;
  commissionEarned: string;
  netPosition: string;
  policyCount: number;
  claimCount: number;
}

export interface ProfitabilitySection {
  byLine: ProfitabilityRow[];
  bySegment: ProfitabilityRow[];
  totals: Omit<ProfitabilityRow, 'key' | 'label'>;
}

export interface FinancialReportSummary {
  asOf: string;
  currency: string;
  receivables: FinancialReportReceivables;
  payables: FinancialReportPayables;
  commission: CommissionRollup;
  profitability: ProfitabilitySection;
}

export function getFinancialReportSummary(
  opts: { asOf?: string } = {},
): Promise<FinancialReportSummary> {
  const qs = opts.asOf ? `?asOf=${encodeURIComponent(opts.asOf)}` : '';
  return apiGet(`/financial-report/summary${qs}`);
}
