import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProfitabilityAnalysisService } from './profitability-analysis.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 63 — `profitability-analysis.view` (already pre-seeded, Executive
 * Management / Finance — NOT Branch/Department Manager, unlike #58-62) gates
 * the one read here. No new permission, no migration, no scheduler — a live
 * snapshot, the #62 shape.
 */
@ApiTags('management-reporting')
@Controller('profitability-analysis')
export class ProfitabilityAnalysisController {
  constructor(private readonly profitability: ProfitabilityAnalysisService) {}

  @RequirePermissions('profitability-analysis.view')
  @Get()
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.profitability.summary(user.id);
  }
}
