import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { KpiDashboardService } from './kpi-dashboard.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 58 (backlog Part C #58, Domain G — opens Domain G) — General KPI
 * dashboard.
 *
 *   - `GET /kpi-dashboard` — a book-wide, live-computed summary across every
 *     domain built so far.
 *
 * `kpi-dashboard.view` (`[BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT]`)
 * gates the route. No `AuthModule` import — the global `PermissionsGuard` /
 * `@CurrentUser` cover it (the `SlaDashboardController` pattern).
 */
@ApiTags('management-reporting')
@Controller('kpi-dashboard')
export class KpiDashboardController {
  constructor(private readonly kpiDashboard: KpiDashboardService) {}

  @RequirePermissions('kpi-dashboard.view')
  @Get()
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.kpiDashboard.summary(user.id);
  }
}
