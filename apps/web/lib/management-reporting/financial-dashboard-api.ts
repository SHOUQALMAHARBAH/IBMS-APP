// Part E — Financial Dashboard (backlog Process #64). dashboard.financial.view
// (already pre-seeded) gates this read.

import { apiGet } from '../auth/api-client';

export interface ReceivablesAgeingBucketAmounts {
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
}
export interface CustomerReceivablesRow extends ReceivablesAgeingBucketAmounts {
  customerId: string;
  customerLegalName: string;
  currency: string;
  outstandingTotal: string;
  invoiceCount: number;
  oldestDueDate: string | null;
  oldestDaysOverdue: number;
}
export interface ReceivablesAgeingReport {
  asOf: string;
  currency: string;
  rows: CustomerReceivablesRow[];
  totals: ReceivablesAgeingBucketAmounts & { outstandingTotal: string; invoiceCount: number; customerCount: number };
}

export interface InsurerPayableRow {
  insurerId: string;
  insurerName: string;
  outstandingAmount: string;
  outstandingCount: number;
  oldestCollectedAt: string | null;
  oldestDaysOutstanding: number;
  remittedAmount: string;
  remittedCount: number;
}
export interface InsurerPayablesReport {
  asOf: string;
  currency: string;
  rows: InsurerPayableRow[];
  totals: { outstandingAmount: string; outstandingCount: number; remittedAmount: string; remittedCount: number; insurerCount: number };
}

export interface CommissionRollupFigures {
  earned: string;
  vat: string;
  gross: string;
  netEarned: string;
  paid: string;
  reversed: string;
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

export interface FinancialDashboardSummary {
  generatedAt: string;
  asOf: string;
  currency: string;
  receivables: ReceivablesAgeingReport;
  payables: InsurerPayablesReport;
  commission: CommissionRollup;
  profitability: ProfitabilitySection;
}

export function getFinancialDashboard(opts: {
  branchId?: string;
  insuranceLine?: string;
  insurerId?: string;
  asOf?: string;
} = {}): Promise<FinancialDashboardSummary> {
  const params = new URLSearchParams();
  if (opts.branchId) params.set('branchId', opts.branchId);
  if (opts.insuranceLine) params.set('insuranceLine', opts.insuranceLine);
  if (opts.insurerId) params.set('insurerId', opts.insurerId);
  if (opts.asOf) params.set('asOf', opts.asOf);
  const qs = params.toString();
  return apiGet(`/dashboards/financial${qs ? `?${qs}` : ''}`);
}
