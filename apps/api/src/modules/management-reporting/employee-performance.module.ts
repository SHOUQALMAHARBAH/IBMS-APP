import { Module } from '@nestjs/common';
import { EmployeePerformanceController } from './employee-performance.controller';
import { EmployeePerformanceService } from './employee-performance.service';
import { EmployeePerformanceScheduler } from './employee-performance.scheduler';
import { EmployeePerformanceRepository } from '../../repositories/employee-performance.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Process 61 (backlog Part C #61, Domain G) — "Employee Performance —
 * `EmployeePerformanceRecord`: a periodic job: new clients/premium/
 * commission/renewal rate/cross-sell rate." `EmployeePerformanceRecord`
 * already exists in the core schema — this module is its first real
 * consumer, alongside `Employee` and `User.employeeId` (both dormant —
 * Domain H/#66 HR is not built).
 *
 *   - AuditModule -> AuditService (a CREATE/UPDATE row per employee per
 *     compute run).
 *   - AuthModule -> UserRepository (the scheduler's system-service-account
 *     lookup, the UpSellDetectionScheduler/InsurerPerformanceScheduler
 *     shape).
 *   - The global `PermissionsGuard` / `@CurrentUser` cover the controller;
 *     `ScheduleModule.forRoot()` (already registered in AppModule) makes
 *     `@Cron` on `EmployeePerformanceScheduler` fire.
 *
 * No new permission — `employee-performance.view` (pre-seeded) gates both
 * the read and the manual compute trigger, the #60 `insurer-performance.
 * view` precedent.
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [EmployeePerformanceController],
  providers: [
    EmployeePerformanceService,
    EmployeePerformanceRepository,
    EmployeePerformanceScheduler,
  ],
})
export class EmployeePerformanceModule {}
