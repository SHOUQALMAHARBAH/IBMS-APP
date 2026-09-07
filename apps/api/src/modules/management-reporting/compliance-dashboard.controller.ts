import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ComplianceDashboardService } from './compliance-dashboard.service';
import { ComplianceDashboardQueryDto } from './dto/compliance-dashboard-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Part E — Compliance Dashboard. `dashboard.compliance.view` (already
 * pre-seeded — Compliance Officer, DPO, Manager, Executive) gates this
 * read. */
@ApiTags('management-reporting')
@Controller('dashboards')
export class ComplianceDashboardController {
  constructor(private readonly dashboard: ComplianceDashboardService) {}

  @RequirePermissions('dashboard.compliance.view')
  @Get('compliance')
  summary(
    @Query() query: ComplianceDashboardQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dashboard.summary(query, user.id);
  }
}
