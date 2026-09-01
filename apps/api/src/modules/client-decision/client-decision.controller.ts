import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClientDecisionService } from './client-decision.service';
import { CaptureClientDecisionDto } from './dto/capture-client-decision.dto';
import { ListClientDecisionsQueryDto } from './dto/list-client-decisions-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 17 — Client Decision Handling (backlog Part C #17, Domain B).
 * Capture the client's single decision on a sent recommendation and route
 * the parent Opportunity (placement / close / renewed negotiation). See
 * client-decision.service.ts for the rules. Frontend: the "Client decision"
 * section on apps/web/app/(app)/opportunities/[id]/. */
@ApiTags('client-decisions')
@Controller('client-decisions')
export class ClientDecisionController {
  constructor(private readonly clientDecisions: ClientDecisionService) {}

  @RequirePermissions('client-decision.capture')
  @Post()
  capture(
    @Body() dto: CaptureClientDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clientDecisions.capture(dto, user);
  }

  @RequirePermissions('client-decision.read')
  @Get()
  list(
    @Query() query: ListClientDecisionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clientDecisions.list(query, user);
  }

  @RequirePermissions('client-decision.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clientDecisions.get(id, user);
  }
}
