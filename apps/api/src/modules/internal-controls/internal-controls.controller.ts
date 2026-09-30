import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InternalControlsService } from './internal-controls.service';
import { CombinedDutyReportService } from './combined-duty-report.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 56 (backlog Part C #56, Domain F) — Internal Controls (Maker/
 * Checker).
 *
 *   - `GET /internal-controls/self-approval-audit` — runs the live
 *     registry-driven scan (see `internal-controls.config.ts`) across every
 *     maker/checker pair in the schema and returns the report. The same
 *     scan the nightly `InternalControlsAuditScheduler` runs.
 *
 * `internal-controls.view` (`[COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT,
 * EXTERNAL_AUDITOR]` — the `sla-dashboard.view` role set minus
 * `BRANCH_DEPARTMENT_MANAGER`: this report names which STAFF member sits on
 * both sides of a control failure, a step more sensitive than an SLA
 * timer's state, so it stays with the roles whose job is auditing controls
 * rather than a line manager's day-to-day). No `AuthModule` import — the
 * global `PermissionsGuard` / `@CurrentUser` cover it (the
 * `SlaDashboardController` pattern). Named `.view` (not `.audit`) to match
 * the `.read`/`.view`-only naming convention every other EXTERNAL_AUDITOR
 * grant follows — `permissions.spec.ts`'s "External Auditor is read-only by
 * construction" test checks this by code suffix, and this route is a plain
 * GET with no mutation, so the name should say so.
 */
@ApiTags('internal-controls')
@Controller('internal-controls')
export class InternalControlsController {
  constructor(
    private readonly internalControls: InternalControlsService,
    private readonly combinedDuty: CombinedDutyReportService,
  ) {}

  @RequirePermissions('internal-controls.view')
  @Get('self-approval-audit')
  selfApprovalAudit(@CurrentUser() user: AuthenticatedUser) {
    return this.internalControls.runSelfApprovalAudit(user.id);
  }

  /**
   * Part 4 step 6 — THE SELF-APPROVAL REPORT, and the shipping gate for COMBINED mode.
   *
   * The sibling above scans for SILENT self-approvals, which the CHECK constraints refuse and which should
   * therefore find none. This one lists the DECLARED ones, with their reasons and the roles the actor wore.
   * Both on the same screen, because a reviewer asking "who has been on both sides of a control" needs both
   * answers and neither is the other.
   */
  @RequirePermissions('internal-controls.view')
  @Get('combined-duty-acts')
  combinedDutyActs(@CurrentUser() user: AuthenticatedUser) {
    return this.combinedDuty.run(user);
  }
}
