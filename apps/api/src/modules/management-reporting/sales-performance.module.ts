import { Module } from '@nestjs/common';
import { SalesPerformanceController } from './sales-performance.controller';
import { SalesPerformanceService } from './sales-performance.service';
import { SalesPerformanceRepository } from '../../repositories/sales-performance.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 59 (backlog Part C #59, Domain G) — "Sales Performance: a query
 * per employee/team against target." `SalesTarget` is a genuinely new
 * model/migration this process adds (unlike #60/#61's `InsurerPerformance
 * Score`/`EmployeePerformanceRecord`, both already in the core schema) —
 * see `ibms-brain/meta/context/sales-performance.md`.
 *
 *   - AuditModule -> AuditService (a best-effort audit row per write and
 *     per performance read).
 *   - The global `PermissionsGuard` / `@CurrentUser` cover the controller.
 *
 * New permission `sales-target.manage` (Manager/Executive) gates the target
 * registry; `dashboard.sales.view` (already pre-seeded) gates the read.
 */
@Module({
  imports: [AuditModule],
  controllers: [SalesPerformanceController],
  providers: [SalesPerformanceService, SalesPerformanceRepository],
})
export class SalesPerformanceModule {}
