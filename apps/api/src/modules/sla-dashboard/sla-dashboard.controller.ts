import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SlaDashboardService } from './sla-dashboard.service';
import { SlaDashboardTimersQueryDto } from './dto/sla-dashboard-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 43 (backlog Part C #43, Domain E) — SLA Management. The cross-module
 * monitoring dashboard over the generic `SlaTimer` engine:
 *
 *   - `GET /sla-dashboard/summary` — book-wide totals + a per-workflow /
 *     per-entity-type / per-escalation-target breakdown of live timer state
 *     (on track / due soon / breached / escalated / resolved), with a
 *     `breachRate`.
 *   - `GET /sla-dashboard/timers?state=&entityType=&workflowName=` — the
 *     filterable per-timer drill-down, worst-first.
 *
 * Both are `sla-dashboard.view` (`[COMPLIANCE_OFFICER,
 * BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]`, seeded
 * in `a440c1b` — no seed change). No `AuthModule` import — the global
 * `PermissionsGuard` / `@CurrentUser` cover it (the `FinancialReportController`
 * pattern). Frontend: the "SLA dashboard" screen at
 * apps/web/app/(app)/sla-dashboard/.
 */
@ApiTags('customer-service')
@Controller('sla-dashboard')
export class SlaDashboardController {
  constructor(private readonly slaDashboard: SlaDashboardService) {}

  @RequirePermissions('sla-dashboard.view')
  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.slaDashboard.summary(user.id);
  }

  @RequirePermissions('sla-dashboard.view')
  @Get('timers')
  timers(
    @Query() query: SlaDashboardTimersQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.slaDashboard.timers(
      {
        state: query.state,
        entityType: query.entityType,
        workflowName: query.workflowName,
      },
      user.id,
    );
  }
}
