import { Module } from '@nestjs/common';
import { ExecutiveDashboardController } from './executive-dashboard.controller';
import { ExecutiveDashboardService } from './executive-dashboard.service';
import { SalesDashboardModule } from './sales-dashboard.module';
import { PolicyDashboardModule } from './policy-dashboard.module';
import { ClaimsDashboardModule } from './claims-dashboard.module';
import { FinancialDashboardModule } from './financial-dashboard.module';
import { ComplianceDashboardModule } from './compliance-dashboard.module';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 64 — Executive Management Reporting (backlog Part C #64 / Part E).
 * The sixth and last of Part E's named dashboards to be wired.
 *
 * `dashboard.executive.view` has been in the seeded permission grid since the
 * original RBAC build and was the ONLY dashboard permission with no endpoint
 * behind it — an executive holding it got 403 from a route that did not
 * exist. This module is that route.
 *
 * Unlike every other module here it provides no repository: it composes the
 * five sibling dashboard services (all exported from this same module folder)
 * instead of re-querying the tables. See `executive-dashboard.service.ts` for
 * why that narrow exception to the "read tables directly" convention is the
 * right call for a roll-up specifically.
 *
 * No migration, no seed change.
 */
@Module({
  imports: [
    AuditModule,
    SalesDashboardModule,
    PolicyDashboardModule,
    ClaimsDashboardModule,
    FinancialDashboardModule,
    ComplianceDashboardModule,
  ],
  controllers: [ExecutiveDashboardController],
  providers: [ExecutiveDashboardService],
})
export class ExecutiveDashboardModule {}
