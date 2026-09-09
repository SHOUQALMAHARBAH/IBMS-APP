import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { SalesDashboardService } from './sales-dashboard.service';
import { PolicyDashboardService } from './policy-dashboard.service';
import { ClaimsDashboardService } from './claims-dashboard.service';
import { FinancialDashboardService } from './financial-dashboard.service';
import { ComplianceDashboardService } from './compliance-dashboard.service';
import {
  buildExecutiveDashboardSummary,
  type ExecutiveDashboardSummary,
} from './executive-dashboard.config';
import type { ExecutiveDashboardQueryDto } from './dto/executive-dashboard-query.dto';

/**
 * Process 64 — Executive Management Reporting (backlog Part C #64 / Part E).
 *
 * Composes the five existing dashboards rather than querying the tables a
 * sixth time. That is a deliberate exception to this codebase's "a reporting
 * module reads tables directly, never another domain's service" rule, and it
 * is a narrow one: every service composed here lives in THIS module. The rule
 * exists to stop a reporting module taking a dependency on a DOMAIN service
 * (whose visibility rules, side effects and transaction boundaries are not a
 * reporting concern) — the sibling dashboards are pure reads with no writes
 * and no side effects beyond their own audit row.
 *
 * The alternative — a sixth `ExecutiveDashboardRepository` re-deriving the
 * same aggregates — is exactly the shape that produced `IMPROVEMENTS.md`
 * §3.1's two-sources-of-truth commission bug. An executive summary that
 * disagrees with the dashboard it summarises is worse than no summary.
 *
 * Permission: `dashboard.executive.view` (`[EXECUTIVE_MANAGEMENT,
 * BRANCH_DEPARTMENT_MANAGER]`), seeded since the original RBAC grid and
 * unwired until now. Both are cross-book roles, so this read is book-wide;
 * `branchId` narrows it by choice, not by enforcement.
 */
@Injectable()
export class ExecutiveDashboardService {
  private readonly logger = new Logger(ExecutiveDashboardService.name);

  constructor(
    private readonly sales: SalesDashboardService,
    private readonly policy: PolicyDashboardService,
    private readonly claims: ClaimsDashboardService,
    private readonly financial: FinancialDashboardService,
    private readonly compliance: ComplianceDashboardService,
    private readonly audit: AuditService,
  ) {}

  async summary(
    query: ExecutiveDashboardQueryDto,
    actorUserId: string,
  ): Promise<ExecutiveDashboardSummary> {
    const periodQuery = {
      branchId: query.branchId,
      insuranceLine: query.insuranceLine,
      insurerId: query.insurerId,
      periodLabel: query.periodLabel,
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
    };
    const asOfQuery = {
      branchId: query.branchId,
      insuranceLine: query.insuranceLine,
      insurerId: query.insurerId,
      asOf: query.asOf,
    };

    // Concurrent — five independent reads, no ordering between them (the #58
    // `Promise.all`-over-sequential-queries lesson).
    const [sales, policy, claims, financial, compliance] = await Promise.all([
      this.sales.summary(periodQuery, actorUserId),
      this.policy.summary(periodQuery, actorUserId),
      this.claims.summary(asOfQuery, actorUserId),
      this.financial.summary(asOfQuery, actorUserId),
      this.compliance.summary({ branchId: query.branchId }, actorUserId),
    ]);

    const view = buildExecutiveDashboardSummary({
      now: new Date(),
      sales,
      policy,
      claims,
      financial,
      compliance,
    });

    // Each composed dashboard writes its own READ row; this one records that
    // the executive roll-up itself was read, so the audit trail shows the
    // cross-cutting access and not just five apparently unrelated reads.
    // Filters and the resolved window only — never a figure.
    await this.safeAudit(actorUserId, query, view);
    return view;
  }

  private async safeAudit(
    actorUserId: string,
    query: ExecutiveDashboardQueryDto,
    view: ExecutiveDashboardSummary,
  ): Promise<void> {
    try {
      await this.audit.record({
        userId: actorUserId,
        action: 'READ',
        entityType: 'ExecutiveDashboard',
        entityId: query.branchId ?? 'book-wide',
        afterValue: {
          branchId: query.branchId ?? null,
          insuranceLine: query.insuranceLine ?? null,
          insurerId: query.insurerId ?? null,
          periodLabel: view.periodLabel,
          periodStart: view.periodStart,
          periodEnd: view.periodEnd,
          asOf: view.asOf,
        },
      });
    } catch (err) {
      this.logger.error(
        `Executive dashboard READ audit did not write: ${(err as Error).message}`,
      );
    }
  }
}
