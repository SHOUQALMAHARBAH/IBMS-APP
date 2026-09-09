import { Module } from '@nestjs/common';
import { SalesDashboardController } from './sales-dashboard.controller';
import { SalesDashboardService } from './sales-dashboard.service';
import { SalesDashboardRepository } from '../../repositories/sales-dashboard.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Part E — Dashboards & Management Reporting (Part 13), backlog Process
 * #64 ("Executive Management Reporting — Part E below"), first of the six
 * named dashboards: "new leads and conversion rate, premium written (new
 * vs. renewal), commission income, cross-sell/up-sell opportunity
 * conversion." See `sales-dashboard.config.ts` for the full design note.
 *
 * `SalesDashboardRepository` reads `Lead`/`Policy`/`Opportunity`/
 * `CommissionLedgerEntry`/`CrossSellOpportunity`/`UpSellRecommendation`
 * DIRECTLY — no cross-module service dependency, the #58 KPI Dashboard /
 * #62 Portfolio Analysis shape.
 *
 * No migration (a pure read over existing tables + the already-schema'd
 * `Opportunity.isRenewal` flag). No new permission — `dashboard.sales.view`
 * was pre-seeded ahead of time for exactly this process (Domain G / #59's
 * own module doc comment already anticipated it).
 */
@Module({
  imports: [AuditModule],
  controllers: [SalesDashboardController],
  providers: [SalesDashboardService, SalesDashboardRepository],
  // Exported for `ExecutiveDashboardService` (#64), which rolls this
  // dashboard up rather than re-deriving its figures from the same tables.
  exports: [SalesDashboardService],
})
export class SalesDashboardModule {}
