import { Module } from '@nestjs/common';
import { InsurerPerformanceController } from './insurer-performance.controller';
import { InsurerPerformanceService } from './insurer-performance.service';
import { InsurerPerformanceScheduler } from './insurer-performance.scheduler';
import { InsurerPerformanceRepository } from '../../repositories/insurer-performance.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Process 60 (backlog Part C #60, Domain G) — "Insurer Performance —
 * `InsurerPerformanceScore`: a periodic job computing the score from
 * quote-response speed/claims service/price/service quality." Unlike #58/
 * #59, `InsurerPerformanceScore` and `InsurerSlaAgreement` already exist in
 * the core schema — this module is their first real consumer. See
 * `ibms-brain/meta/context/insurer-performance.md`.
 *
 *   - AuditModule -> AuditService (a CREATE/UPDATE row per insurer per
 *     compute run).
 *   - AuthModule -> UserRepository (the scheduler's system-service-account
 *     lookup, the UpSellDetectionScheduler shape).
 *   - The global `PermissionsGuard` / `@CurrentUser` cover the controller;
 *     `ScheduleModule.forRoot()` (already registered in AppModule) makes
 *     `@Cron` on `InsurerPerformanceScheduler` fire.
 *
 * No migration for a new model (none needed) — only a hand-authored
 * `@@unique([insurerId, periodLabel])` on the pre-existing table. No new
 * permission — `insurer-performance.view` (pre-seeded) gates both the read
 * and the manual compute trigger.
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [InsurerPerformanceController],
  providers: [
    InsurerPerformanceService,
    InsurerPerformanceRepository,
    InsurerPerformanceScheduler,
  ],
})
export class InsurerPerformanceModule {}
