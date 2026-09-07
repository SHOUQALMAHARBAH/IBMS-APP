import { Module } from '@nestjs/common';
import { FinancialDashboardController } from './financial-dashboard.controller';
import { FinancialDashboardService } from './financial-dashboard.service';
import { FinancialDashboardRepository } from '../../repositories/financial-dashboard.repository';
import { InvoiceRepository } from '../../repositories/invoice.repository';
import { FinancialReportRepository } from '../../repositories/financial-report.repository';
import { ProfitabilityPolicyRepository } from '../../repositories/profitability-policy.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Part E — Dashboards & Management Reporting (Part 13), backlog Process
 * #64. The fourth of the six named dashboards: "receivables and ageing,
 * payables to insurers, commission income and outstanding commission,
 * profitability by client segment/line." See `financial-dashboard.
 * config.ts` for the full design note — #40's own `FinancialReportService`
 * already computes every section; this module adds the branch/line/insurer
 * filtering #40's own DTO explicitly deferred as "a Part E dashboard
 * refinement."
 *
 * `InvoiceRepository` / `FinancialReportRepository` /
 * `ProfitabilityPolicyRepository` are ALSO provided by `FinanceModule` (and
 * `ProfitabilityAnalysisModule`, for the last one) — the same classes
 * independently instantiated here, both wrapping the singleton
 * `PrismaService`. No `imports`/`exports` wiring to `FinanceModule` at all —
 * the #63 Profitability Analysis / Claims Dashboard "share the repository,
 * not the service" precedent.
 *
 * No migration. No new permission — `dashboard.financial.view` was
 * pre-seeded ahead of time for exactly this process.
 */
@Module({
  imports: [AuditModule],
  controllers: [FinancialDashboardController],
  providers: [
    FinancialDashboardService,
    FinancialDashboardRepository,
    InvoiceRepository,
    FinancialReportRepository,
    ProfitabilityPolicyRepository,
  ],
})
export class FinancialDashboardModule {}
