import { Module } from '@nestjs/common';
import { KpiDashboardController } from './kpi-dashboard.controller';
import { KpiDashboardService } from './kpi-dashboard.service';
import { KpiDashboardRepository } from '../../repositories/kpi-dashboard.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Domain G — Management (backlog Part C #58–65). Opens with Process 58,
 * General KPI dashboard (`KpiDashboardService`): a read-only, cross-cutting
 * aggregation over every domain built so far (Sales/CRM, Policy, Claims,
 * Finance, Customer Service, Compliance & Risk) — it owns none of the
 * tables it reads, the `SlaDashboardModule` shape. `KpiDashboardRepository`
 * queries every underlying table DIRECTLY via `count`/`groupBy`/`aggregate`
 * rather than composing `FinancialReportService`/`SlaDashboardService`/
 * `ClaimsAnalyticsService` — no cross-module service dependency, matching
 * how every other cross-cutting reporting module in this codebase reads
 * tables itself rather than calling into another domain's service (see
 * `ibms-brain/meta/context/kpi-dashboard.md`).
 *
 *   - AuditModule -> AuditService (a best-effort `READ` row per read).
 *   - The global `PermissionsGuard` / `@CurrentUser` cover the controller.
 *
 * No migration (a pure read over existing tables). New permission
 * `kpi-dashboard.view` — this is genuinely new capability, not pre-seeded
 * ahead of time the way the OTHER Domain G permissions (`dashboard.sales.
 * view`, `insurer-performance.view`, ...) already were for #59–65.
 */
@Module({
  imports: [AuditModule],
  controllers: [KpiDashboardController],
  providers: [KpiDashboardService, KpiDashboardRepository],
})
export class KpiDashboardModule {}
