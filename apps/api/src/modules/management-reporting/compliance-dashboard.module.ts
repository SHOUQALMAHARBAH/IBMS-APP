import { Module } from '@nestjs/common';
import { ComplianceDashboardController } from './compliance-dashboard.controller';
import { ComplianceDashboardService } from './compliance-dashboard.service';
import { ComplianceDashboardRepository } from '../../repositories/compliance-dashboard.repository';
import { AuditTrailRepository } from '../../repositories/audit-trail.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Part E — Dashboards & Management Reporting (Part 13), backlog Process
 * #64. The fifth of the six named dashboards: "KYC status (approved/
 * pending/overdue for refresh), complaints by status/category, compliance
 * breaches/exceptions, regulatory filing/report status, open DSRs,
 * breach-register status, DPIA backlog." See `compliance-dashboard.
 * config.ts` for the full design note — seven sections, each reading a
 * different existing table directly, the DPO Workspace aggregate-screen
 * shape.
 *
 * `AuditTrailRepository` is ALSO provided by `AuditTrailModule` — the same
 * class independently instantiated here, wrapping the singleton
 * `PrismaService`. No `imports`/`exports` wiring to it at all — the #63
 * Profitability Analysis / Claims Dashboard / Financial Dashboard "share
 * the repository, not the service" precedent, reused here to read the most
 * recent Internal Controls self-approval scan without re-running its own
 * expensive live audit.
 *
 * No migration. No new permission — `dashboard.compliance.view` was
 * pre-seeded ahead of time for exactly this process.
 */
@Module({
  imports: [AuditModule],
  controllers: [ComplianceDashboardController],
  providers: [
    ComplianceDashboardService,
    ComplianceDashboardRepository,
    AuditTrailRepository,
  ],
  // Exported for `ExecutiveDashboardService` (#64), which rolls this
  // dashboard up rather than re-deriving its figures from the same tables.
  exports: [ComplianceDashboardService],
})
export class ComplianceDashboardModule {}
