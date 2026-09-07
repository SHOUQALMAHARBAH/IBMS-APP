import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClaimsAnalyticsService } from './claims-analytics.service';
import { LossRatioBreakdownQueryDto } from './dto/loss-ratio-breakdown-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 30 (backlog Part C #30) — Claims Analytics. `GET
 * /claims-analytics/loss-ratio?groupBy=customer|policy|line` returns the
 * aggregate `Claims ÷ Premium` breakdown (paid net settlements ÷ written
 * premium, all-time) that feeds the reporting dashboard and, once built, the
 * renewal workflow. Book-wide read — `claims-analytics.view` is
 * `[CLAIMS_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT,
 * EXTERNAL_AUDITOR]`.
 */
@ApiTags('claims-analytics')
@Controller('claims-analytics')
export class ClaimsAnalyticsController {
  constructor(private readonly analytics: ClaimsAnalyticsService) {}

  @RequirePermissions('claims-analytics.view')
  @Get('loss-ratio')
  lossRatioBreakdown(
    @Query() query: LossRatioBreakdownQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.analytics.lossRatioBreakdown(
      {
        groupBy: query.groupBy,
        customerId: query.customerId,
        policyId: query.policyId,
        insuranceLine: query.insuranceLine,
      },
      user,
    );
  }
}
