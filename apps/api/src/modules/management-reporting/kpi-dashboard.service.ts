import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { KpiDashboardRepository } from '../../repositories/kpi-dashboard.repository';
import {
  buildStatusCountMap,
  formatMoneySum,
  startOfCurrentUtcMonth,
  type KpiDashboardSummary,
} from './kpi-dashboard.config';

/**
 * Process 58 — "General KPI dashboard: aggregate queries across every
 * module above." Every figure is computed concurrently (`Promise.all`) via
 * a single DB-side `count`/`groupBy`/`aggregate` call each — the #56
 * `Promise.all`-over-sequential-queries lesson applied from the start here,
 * not discovered via a timing e2e failure. `kpi-dashboard.view`
 * (`[BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT]`) is a genuinely new
 * permission — Part 5.1's own role table names exactly these two roles as
 * "View dashboards and reports across the organization"; External Auditor
 * is deliberately NOT included (the #57 lesson: their scope is logs/
 * documents/workflow history, not live business-KPI content).
 */
@Injectable()
export class KpiDashboardService {
  private readonly logger = new Logger(KpiDashboardService.name);

  constructor(
    private readonly repo: KpiDashboardRepository,
    private readonly audit: AuditService,
  ) {}

  async summary(actorUserId: string): Promise<KpiDashboardSummary> {
    const now = new Date();
    const monthStart = startOfCurrentUtcMonth(now);

    const [
      totalCustomers,
      leadsByStatus,
      prospectsByStatus,
      opportunitiesByStatus,
      policiesByStatus,
      totalIssuedPremium,
      claimsByStatus,
      outstandingInvoiced,
      invoicesByStatus,
      commissionThisMonth,
      complaintsByStatus,
      openServiceRequests,
      openRiskRegisterItems,
      openIncidents,
      openInternalAuditFindings,
    ] = await Promise.all([
      this.repo.countCustomers(),
      this.repo.countByStatus('lead'),
      this.repo.countByStatus('prospect'),
      this.repo.countByStatus('opportunity'),
      this.repo.countByStatus('policy'),
      this.repo.sumIssuedPremium(),
      this.repo.countByStatus('claim'),
      this.repo.sumOutstandingInvoiced(),
      this.repo.countByStatus('invoice'),
      this.repo.sumCommissionSince(monthStart),
      this.repo.countByStatus('complaint'),
      this.repo.countOpenServiceRequests(),
      this.repo.countOpenRiskRegisterItems(),
      this.repo.countOpenIncidents(),
      this.repo.countOpenInternalAuditFindings(),
    ]);

    const summary: KpiDashboardSummary = {
      generatedAt: now.toISOString(),
      sales: {
        totalCustomers,
        leadsByStatus: buildStatusCountMap(leadsByStatus),
        prospectsByStatus: buildStatusCountMap(prospectsByStatus),
        opportunitiesByStatus: buildStatusCountMap(opportunitiesByStatus),
      },
      policy: {
        policiesByStatus: buildStatusCountMap(policiesByStatus),
        totalIssuedPremiumJod: formatMoneySum(totalIssuedPremium),
      },
      claims: {
        claimsByStatus: buildStatusCountMap(claimsByStatus),
      },
      finance: {
        outstandingInvoicedJod: formatMoneySum(outstandingInvoiced),
        invoicesByStatus: buildStatusCountMap(invoicesByStatus),
        commissionThisMonthJod: formatMoneySum(commissionThisMonth),
      },
      customerService: {
        complaintsByStatus: buildStatusCountMap(complaintsByStatus),
        openServiceRequests,
      },
      complianceRisk: {
        openRiskRegisterItems,
        openIncidents,
        openInternalAuditFindings,
      },
    };

    await this.recordReadBestEffort(actorUserId, summary);
    return summary;
  }

  private async recordReadBestEffort(
    userId: string,
    summary: KpiDashboardSummary,
  ): Promise<void> {
    try {
      await this.audit.record({
        userId,
        action: 'READ',
        entityType: 'KpiDashboard',
        entityId: 'summary',
        afterValue: {
          view: 'kpi-dashboard-summary',
          generatedAt: summary.generatedAt,
          totalCustomers: summary.sales.totalCustomers,
          openServiceRequests: summary.customerService.openServiceRequests,
          openRiskRegisterItems: summary.complianceRisk.openRiskRegisterItems,
          openIncidents: summary.complianceRisk.openIncidents,
        },
      });
    } catch (err) {
      this.logger.error(
        `KPI dashboard READ audit did not write: ${(err as Error).message}`,
      );
    }
  }
}
