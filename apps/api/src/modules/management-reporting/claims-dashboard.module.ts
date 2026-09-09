import { Module } from '@nestjs/common';
import { ClaimsDashboardController } from './claims-dashboard.controller';
import { ClaimsDashboardService } from './claims-dashboard.service';
import { ClaimsDashboardRepository } from '../../repositories/claims-dashboard.repository';
import { LossRatioRepository } from '../../repositories/loss-ratio.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Part E — Dashboards & Management Reporting (Part 13), backlog Process
 * #64. The third of the six named dashboards: "open vs. closed claims,
 * outstanding claims value, claims ageing, loss ratio by
 * client/line/insurer." See `claims-dashboard.config.ts` for the full
 * design note.
 *
 * `ClaimsDashboardRepository` reads `Claim`/`Settlement` DIRECTLY — no
 * cross-module SERVICE dependency (the #58 KPI Dashboard / Sales / Policy
 * Dashboard shape). `LossRatioRepository` is ALSO provided by
 * `LossRatioModule` (#29-30) — the same class independently instantiated in
 * two modules' own `providers` arrays, both wrapping the singleton
 * `PrismaService`. No `imports`/`exports` wiring to `LossRatioModule` at
 * all — the #63 Profitability Analysis "share the repository, not the
 * service" precedent.
 *
 * No migration (a pure read over existing tables). No new permission —
 * `dashboard.claims.view` was pre-seeded ahead of time for exactly this
 * process.
 */
@Module({
  imports: [AuditModule],
  controllers: [ClaimsDashboardController],
  providers: [
    ClaimsDashboardService,
    ClaimsDashboardRepository,
    LossRatioRepository,
  ],
  // Exported for `ExecutiveDashboardService` (#64), which rolls this
  // dashboard up rather than re-deriving its figures from the same tables.
  exports: [ClaimsDashboardService],
})
export class ClaimsDashboardModule {}
