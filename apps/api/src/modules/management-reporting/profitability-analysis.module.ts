import { Module } from '@nestjs/common';
import { ProfitabilityAnalysisController } from './profitability-analysis.controller';
import { ProfitabilityAnalysisService } from './profitability-analysis.service';
import { ProfitabilityPolicyRepository } from '../../repositories/profitability-policy.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 63 (backlog Part C #63, Domain G) — "Profitability Analysis:
 * commission income vs. cost-to-serve per segment/line." A live, book-wide
 * snapshot — no new model, no migration, no scheduler, no new permission
 * (`profitability-analysis.view` was already pre-seeded ahead of time). See
 * `ibms-brain/meta/context/profitability-analysis.md`.
 *
 * `ProfitabilityPolicyRepository` is ALSO provided by `FinanceModule` (#40) —
 * the same class independently instantiated in two modules' own `providers`
 * arrays, both wrapping the singleton `PrismaService`. No `imports`/`exports`
 * wiring between this module and `FinanceModule` at all — the `kpi-
 * dashboard.md` "no cross-module SERVICE dependency" precedent held even
 * while sharing the underlying QUERY.
 *
 *   - AuditModule -> AuditService (a best-effort READ row per read).
 *   - The global `PermissionsGuard` / `@CurrentUser` cover the controller.
 */
@Module({
  imports: [AuditModule],
  controllers: [ProfitabilityAnalysisController],
  providers: [ProfitabilityAnalysisService, ProfitabilityPolicyRepository],
})
export class ProfitabilityAnalysisModule {}
