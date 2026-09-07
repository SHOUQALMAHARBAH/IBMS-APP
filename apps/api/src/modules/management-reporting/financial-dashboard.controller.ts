import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FinancialDashboardService } from './financial-dashboard.service';
import { FinancialDashboardQueryDto } from './dto/financial-dashboard-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Part E — Financial Dashboard. `dashboard.financial.view` (already
 * pre-seeded — Finance, Manager, Executive) gates this read. */
@ApiTags('management-reporting')
@Controller('dashboards')
export class FinancialDashboardController {
  constructor(private readonly dashboard: FinancialDashboardService) {}

  @RequirePermissions('dashboard.financial.view')
  @Get('financial')
  summary(
    @Query() query: FinancialDashboardQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dashboard.summary(query, user.id);
  }
}
