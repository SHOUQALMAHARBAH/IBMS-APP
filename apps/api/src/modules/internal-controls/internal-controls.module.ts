import { Module } from '@nestjs/common';
import { InternalControlsController } from './internal-controls.controller';
import { InternalControlsService } from './internal-controls.service';
import { InternalControlsAuditScheduler } from './internal-controls-audit.scheduler';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Process 56 (backlog Part C #56, Domain F) — Internal Controls (Maker/
 * Checker). A read-only, cross-module scan over the 15 same-table maker/
 * checker pairs backed by a DB `CHECK` constraint (`common/maker-checker.
 * util.ts`'s own covered-pairs table) plus the one cross-table pair no
 * single-table `CHECK` can express (`PolicyChecking.checkedByUserId` vs the
 * parent `Policy.issuedByUserId`) — it does not own or write to any of
 * those tables, so it stays a separate module, the `SlaDashboardModule`
 * shape (aggregates every module's data, is not owned by any one of them).
 *
 *   - AuditModule -> AuditService (a best-effort `READ` row per run, plus a
 *     `CREATE` `InternalControlsViolation` row per finding, if any).
 *   - AuthModule -> UserRepository (the nightly scheduler resolves the
 *     system service account, same as every other scheduler).
 *   - The global `PermissionsGuard` / `@CurrentUser` cover the controller.
 *
 * No migration (a pure read over existing tables). New permission
 * `internal-controls.audit` — this is genuinely new capability, not
 * something Part A.5's original seed anticipated the way #55's four
 * permissions were pre-seeded ahead of time.
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [InternalControlsController],
  providers: [InternalControlsService, InternalControlsAuditScheduler],
})
export class InternalControlsModule {}
