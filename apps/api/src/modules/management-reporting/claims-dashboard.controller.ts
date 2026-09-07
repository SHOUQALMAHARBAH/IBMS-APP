import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClaimsDashboardService } from './claims-dashboard.service';
import { ClaimsDashboardQueryDto } from './dto/claims-dashboard-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Part E — Claims Dashboard. `dashboard.claims.view` (already
 * pre-seeded — Claims Officer, Manager, Executive) gates this read. */
@ApiTags('management-reporting')
@Controller('dashboards')
export class ClaimsDashboardController {
  constructor(private readonly dashboard: ClaimsDashboardService) {}

  @RequirePermissions('dashboard.claims.view')
  @Get('claims')
  summary(
    @Query() query: ClaimsDashboardQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dashboard.summary(query, user.id);
  }
}
