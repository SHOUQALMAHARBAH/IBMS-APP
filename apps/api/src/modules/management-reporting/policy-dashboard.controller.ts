import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PolicyDashboardService } from './policy-dashboard.service';
import { PolicyDashboardQueryDto } from './dto/policy-dashboard-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Part E — Policy Dashboard. `dashboard.policy.view` (already
 * pre-seeded — Placement/Policy Checking Officer, Manager, Executive)
 * gates this read. */
@ApiTags('management-reporting')
@Controller('dashboards')
export class PolicyDashboardController {
  constructor(private readonly dashboard: PolicyDashboardService) {}

  @RequirePermissions('dashboard.policy.view')
  @Get('policy')
  summary(
    @Query() query: PolicyDashboardQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dashboard.summary(query, user.id);
  }
}
