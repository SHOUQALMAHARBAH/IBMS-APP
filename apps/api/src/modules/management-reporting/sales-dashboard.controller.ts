import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SalesDashboardService } from './sales-dashboard.service';
import { SalesDashboardQueryDto } from './dto/sales-dashboard-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Part E — Sales Dashboard. `dashboard.sales.view` (already pre-seeded —
 * Sales/Relationship Officer, Manager, Executive) gates this read, shared
 * with backlog #59's own narrower `GET /sales-performance` endpoint. */
@ApiTags('management-reporting')
@Controller('dashboards')
export class SalesDashboardController {
  constructor(private readonly dashboard: SalesDashboardService) {}

  @RequirePermissions('dashboard.sales.view')
  @Get('sales')
  summary(
    @Query() query: SalesDashboardQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dashboard.summary(query, user.id);
  }
}
