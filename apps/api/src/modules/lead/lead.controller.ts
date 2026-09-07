import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LeadService } from './lead.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { TransitionLeadDto } from './dto/transition-lead.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 1 — Lead Management. Frontend:
 * apps/web/app/(app)/leads/page.tsx (intake form + pipeline board). */
@ApiTags('leads')
@Controller('leads')
export class LeadController {
  constructor(private readonly leads: LeadService) {}

  @RequirePermissions('lead.create')
  @Post()
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.create(dto, user.id);
  }

  @RequirePermissions('lead.list.read')
  @Get()
  list(
    @Query() query: ListLeadsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leads.list(query, user);
  }

  @RequirePermissions('lead.transition')
  @Post(':id/transition')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionLeadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leads.transition(id, dto.toStatus, user.id);
  }
}
