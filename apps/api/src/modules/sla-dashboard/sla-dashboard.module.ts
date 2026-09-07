import { Module } from '@nestjs/common';
import { SlaDashboardController } from './sla-dashboard.controller';
import { SlaDashboardService } from './sla-dashboard.service';
import { SlaDashboardRepository } from '../../repositories/sla-dashboard.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 43 (backlog Part C #43, Domain E — Customer Service) — SLA
 * Management. A read-only monitoring dashboard over the generic `SlaTimer`
 * engine (`apps/api/src/modules/sla/`, backlog A.8) — it aggregates every
 * module's timers, it does not create or resolve them, so it stays a separate
 * module from `SlaModule` (which owns the engine + the escalation sweep), the
 * way `LossRatioModule` is separate from the workflow it reports on.
 *
 *   - AuditModule -> AuditService (a best-effort `READ` row per dashboard read
 *     — the view spans DSR / incident / complaint timers book-wide).
 *   - `SlaTimer` is read via `SlaDashboardRepository` (PrismaService from the
 *     `@Global()` PrismaModule). The `SLA_REGISTRY` (`sla-registry.config.ts`)
 *     is a plain import for workflow labels / configured durations — no DI, so
 *     `SlaModule` is not imported.
 *   - The global `PermissionsGuard` / `@CurrentUser` cover the controller.
 *
 * No migration, no seed change — `sla-dashboard.view` was seeded in `a440c1b`.
 */
@Module({
  imports: [AuditModule],
  controllers: [SlaDashboardController],
  providers: [SlaDashboardService, SlaDashboardRepository],
})
export class SlaDashboardModule {}
