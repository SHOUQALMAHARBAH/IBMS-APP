import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrossSellService } from './cross-sell.service';
import { DetectCrossSellDto } from './dto/detect-cross-sell.dto';
import { ListCrossSellOpportunitiesQueryDto } from './dto/list-cross-sell-opportunities-query.dto';
import { DismissCrossSellOpportunityDto } from './dto/dismiss-cross-sell-opportunity.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 8 — Cross-Selling (backlog Part C #8). A `CrossSellOpportunity`
 * is created only by the gap scan (nightly CrossSellDetectionScheduler, or
 * the on-demand `POST /detect` here) — never by a user "raising" one — then
 * converted or dismissed. See cross-sell.service.ts for the scan rules and
 * the OPEN -> CONVERTED | DISMISSED status chain. Frontend:
 * apps/web/app/(app)/cross-sell/. */
@ApiTags('cross-sell-opportunities')
@Controller('cross-sell-opportunities')
export class CrossSellController {
  constructor(private readonly crossSell: CrossSellService) {}

  /** Refresh one customer's gaps now (the scan is otherwise nightly). */
  @RequirePermissions('cross-sell.detect')
  @Post('detect')
  detect(
    @Body() dto: DetectCrossSellDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.crossSell.detect(dto.customerId, user);
  }

  @RequirePermissions('cross-sell.read')
  @Get()
  list(
    @Query() query: ListCrossSellOpportunitiesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.crossSell.list(query.customerId, user, query.status);
  }

  @RequirePermissions('cross-sell.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.crossSell.get(id, user);
  }

  @RequirePermissions('cross-sell.convert')
  @Post(':id/convert')
  convert(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.crossSell.convert(id, user);
  }

  @RequirePermissions('cross-sell.convert')
  @Post(':id/dismiss')
  dismiss(
    @Param('id') id: string,
    @Body() dto: DismissCrossSellOpportunityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.crossSell.dismiss(id, user, dto.reason);
  }
}
