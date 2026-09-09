import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ExecutiveDashboardService } from './executive-dashboard.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ExecutiveDashboardQueryDto } from './dto/executive-dashboard-query.dto';

/**
 * Process 64 (backlog Part C #64 / Part E) — Executive Management Reporting.
 *
 *   - `GET /dashboards/executive` — the Sales / Policy / Claims / Financial /
 *     Compliance dashboards rolled up, plus a headline block.
 *
 * `dashboard.executive.view` (`[EXECUTIVE_MANAGEMENT,
 * BRANCH_DEPARTMENT_MANAGER]`) gates the route. No `AuthModule` import — the
 * global `PermissionsGuard` / `@CurrentUser` cover it (the
 * `KpiDashboardController` pattern).
 */
@ApiTags('management-reporting')
@Controller('dashboards/executive')
export class ExecutiveDashboardController {
  constructor(private readonly executive: ExecutiveDashboardService) {}

  @RequirePermissions('dashboard.executive.view')
  @Get()
  summary(
    @Query() query: ExecutiveDashboardQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.executive.summary(query, user.id);
  }
}
