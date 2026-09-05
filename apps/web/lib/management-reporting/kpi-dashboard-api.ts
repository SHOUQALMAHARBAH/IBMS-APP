// Process 58 — General KPI dashboard (backlog Part C #58, Domain G — opens
// Domain G). Reads apps/api's GET /kpi-dashboard: a live, book-wide
// aggregate across every domain built so far. kpi-dashboard.view
// (Branch/Department Manager, Executive Management).

import { apiGet } from '../auth/api-client';

export interface KpiDashboardSummary {
  generatedAt: string;
  sales: {
    totalCustomers: number;
    leadsByStatus: Record<string, number>;
    prospectsByStatus: Record<string, number>;
    opportunitiesByStatus: Record<string, number>;
  };
  policy: {
    policiesByStatus: Record<string, number>;
    totalIssuedPremiumJod: string;
  };
  claims: {
    claimsByStatus: Record<string, number>;
  };
  finance: {
    outstandingInvoicedJod: string;
    invoicesByStatus: Record<string, number>;
    commissionThisMonthJod: string;
  };
  customerService: {
    complaintsByStatus: Record<string, number>;
    openServiceRequests: number;
  };
  complianceRisk: {
    openRiskRegisterItems: number;
    openIncidents: number;
    openInternalAuditFindings: number;
  };
}

export function getKpiDashboardSummary(): Promise<KpiDashboardSummary> {
  return apiGet('/kpi-dashboard');
}
