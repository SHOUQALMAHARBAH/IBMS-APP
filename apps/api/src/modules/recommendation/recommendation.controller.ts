import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RecommendationService } from './recommendation.service';
import { DraftRecommendationDto } from './dto/draft-recommendation.dto';
import { DiscloseConflictOfInterestDto } from './dto/disclose-conflict-of-interest.dto';
import { ListRecommendationsQueryDto } from './dto/list-recommendations-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 16 — Broker Recommendation (backlog Part C #16, Domain B). Draft
 * the documented recommendation, gate it on a senior-officer approval above
 * the Opportunity's configurable premium threshold, and require a
 * conflict-of-interest disclosure before it can be sent to the client. See
 * recommendation.service.ts for the rules. Frontend: the "Broker
 * recommendation" section on apps/web/app/(app)/opportunities/[id]/. */
@ApiTags('recommendations')
@Controller('recommendations')
export class RecommendationController {
  constructor(private readonly recommendations: RecommendationService) {}

  @RequirePermissions('recommendation.draft')
  @Post()
  draft(
    @Body() dto: DraftRecommendationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recommendations.draft(dto, user);
  }

  @RequirePermissions('recommendation.read')
  @Get()
  list(
    @Query() query: ListRecommendationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recommendations.list(query, user);
  }

  @RequirePermissions('recommendation.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recommendations.get(id, user);
  }

  /** Senior-officer approval (maker/checker: never the drafter). Only valid
   * when the recommendation is above the Opportunity's target threshold. */
  @RequirePermissions('recommendation.approve')
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recommendations.approve(id, user);
  }

  /** Record the mandatory conflict-of-interest disclosure (acknowledger
   * must differ from the drafter). Only valid when the recommendation was
   * flagged. */
  @RequirePermissions('conflict-of-interest.disclose')
  @Post(':id/conflict-of-interest-disclosure')
  disclose(
    @Param('id') id: string,
    @Body() dto: DiscloseConflictOfInterestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recommendations.discloseConflictOfInterest(id, dto, user);
  }

  /** Send to the client — refused while an approval or a COI disclosure is
   * outstanding. */
  @RequirePermissions('recommendation.send')
  @Post(':id/send')
  send(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recommendations.send(id, user);
  }
}
