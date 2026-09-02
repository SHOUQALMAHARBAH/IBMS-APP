import { Module } from '@nestjs/common';
import { LossRatioService } from './loss-ratio.service';
import { ClaimsAnalyticsService } from './claims-analytics.service';
import { ClaimsAnalyticsController } from './claims-analytics.controller';
import { LossRatioRepository } from '../../repositories/loss-ratio.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 29-30 (backlog Part C #29-30) — Loss Ratio.
 *   - Process 29: `LossRatioService.recomputeForPolicy` recomputes + upserts
 *     the per-`RenewalCase` `LossRatio` row when a claim closes. Consumed by
 *     `ClaimModule` (claim closure) today; the renewal module (Part 3.9, not
 *     built) will consume it too.
 *   - Process 30: `ClaimsAnalyticsController` / `ClaimsAnalyticsService` serve
 *     the aggregate `Claims ÷ Premium` breakdown (`GET
 *     /claims-analytics/loss-ratio`, `claims-analytics.view`) grouped by
 *     customer / policy / line — computed on the fly, no stored aggregate.
 *
 *   - AuditModule -> AuditService (the UPDATE LossRatio row per #29 recompute;
 *     the READ row per #30 breakdown).
 *   - PrismaService comes from the @Global() PrismaModule; the global
 *     PermissionsGuard + `@CurrentUser` come from RbacModule / the global auth
 *     guard (same as CrmModule — no AuthModule import needed).
 */
@Module({
  imports: [AuditModule],
  controllers: [ClaimsAnalyticsController],
  providers: [LossRatioService, ClaimsAnalyticsService, LossRatioRepository],
  exports: [LossRatioService, ClaimsAnalyticsService],
})
export class LossRatioModule {}
