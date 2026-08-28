import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OpportunityService } from './opportunity.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { ListOpportunitiesQueryDto } from './dto/list-opportunities-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). The
 * minimal Opportunity parent an RFQ hangs off — created from a FINALIZED
 * Insurance Program, then list/read only (see opportunity.service.ts for why
 * the lifecycle stops here). Frontend: apps/web/app/(app)/opportunities/,
 * reached from a finalized insurance program. */
@ApiTags('opportunities')
@Controller('opportunities')
export class OpportunityController {
  constructor(private readonly opportunities: OpportunityService) {}

  @RequirePermissions('opportunity.create')
  @Post()
  create(
    @Body() dto: CreateOpportunityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.opportunities.create(dto, user);
  }

  @RequirePermissions('opportunity.read')
  @Get()
  list(
    @Query() query: ListOpportunitiesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.opportunities.list(query.customerId, user);
  }

  @RequirePermissions('opportunity.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.opportunities.get(id, user);
  }
}
