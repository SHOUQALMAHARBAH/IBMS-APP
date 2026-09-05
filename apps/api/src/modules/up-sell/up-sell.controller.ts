import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UpSellService } from './up-sell.service';
import { DetectUpSellDto } from './dto/detect-up-sell.dto';
import { ListUpSellRecommendationsQueryDto } from './dto/list-up-sell-recommendations-query.dto';
import { DismissUpSellRecommendationDto } from './dto/dismiss-up-sell-recommendation.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 9 — Up-Selling (backlog Part C #9). An `UpSellRecommendation` is
 * created only by the under-insurance scan (nightly UpSellDetectionScheduler,
 * or the on-demand `POST /detect` here) — never by a user "raising" one —
 * then converted or dismissed. See up-sell.service.ts for the comparison
 * rules and the OPEN -> CONVERTED | DISMISSED status chain. Frontend:
 * apps/web/app/(app)/up-sell/. */
@ApiTags('up-sell-recommendations')
@Controller('up-sell-recommendations')
export class UpSellController {
  constructor(private readonly upSell: UpSellService) {}

  /** Refresh one customer's under-insurance verdict now (the scan is
   * otherwise nightly). */
  @RequirePermissions('up-sell.detect')
  @Post('detect')
  detect(@Body() dto: DetectUpSellDto, @CurrentUser() user: AuthenticatedUser) {
    return this.upSell.detect(dto.customerId, user);
  }

  @RequirePermissions('up-sell.read')
  @Get()
  list(
    @Query() query: ListUpSellRecommendationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.upSell.list(query.customerId, user, query.status);
  }

  @RequirePermissions('up-sell.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.upSell.get(id, user);
  }

  @RequirePermissions('up-sell.convert')
  @Post(':id/convert')
  convert(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.upSell.convert(id, user);
  }

  @RequirePermissions('up-sell.convert')
  @Post(':id/dismiss')
  dismiss(
    @Param('id') id: string,
    @Body() dto: DismissUpSellRecommendationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.upSell.dismiss(id, user, dto.reason);
  }
}
