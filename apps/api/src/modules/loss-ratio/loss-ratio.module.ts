import { Module } from '@nestjs/common';
import { LossRatioService } from './loss-ratio.service';
import { LossRatioRepository } from '../../repositories/loss-ratio.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 29 (backlog Part C #29) — `Claims ÷ Premium` for a policy's open
 * `RenewalCase`, recomputed when a claim closes. Consumed by `ClaimModule`
 * (claim closure) today; the renewal module (Part 3.9, not built) will consume
 * it too once it exists.
 *   - AuditModule -> AuditService (the UPDATE LossRatio row per recompute)
 *   - PrismaService comes from the @Global() PrismaModule.
 */
@Module({
  imports: [AuditModule],
  providers: [LossRatioService, LossRatioRepository],
  exports: [LossRatioService],
})
export class LossRatioModule {}
