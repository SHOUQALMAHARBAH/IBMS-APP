import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortfolioAnalysisService } from './portfolio-analysis.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 62 — `portfolio-analysis.view` (already pre-seeded, Manager/
 * Executive) gates the one read here. No new permission, no migration, no
 * scheduler — a live snapshot, not a periodic job like #60/#61.
 */
@ApiTags('management-reporting')
@Controller('portfolio-analysis')
export class PortfolioAnalysisController {
  constructor(private readonly portfolio: PortfolioAnalysisService) {}

  @RequirePermissions('portfolio-analysis.view')
  @Get()
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.portfolio.summary(user.id);
  }
}
