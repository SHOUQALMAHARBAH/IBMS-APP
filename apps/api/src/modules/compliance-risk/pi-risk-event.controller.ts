import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PiRiskEventService } from './pi-risk-event.service';
import { CreatePiRiskEventDto } from './dto/create-pi-risk-event.dto';
import { RecordPiRiskEventMitigationDto } from './dto/record-pi-risk-event-mitigation.dto';
import { ListPiRiskEventsQueryDto } from './dto/list-pi-risk-events-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 54 (backlog Part C #53-54's shared header) — the broker's own PI
 * risk events. `pi-policy.manage` (`[COMPLIANCE_OFFICER]`) gates every
 * route — the same permission as the PI policy record itself.
 */
@ApiTags('compliance-risk')
@Controller('pi-risk-events')
export class PiRiskEventController {
  constructor(private readonly events: PiRiskEventService) {}

  @RequirePermissions('pi-policy.manage')
  @Post()
  logManual(
    @Body() dto: CreatePiRiskEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.events.logManual(dto, user.id);
  }

  @RequirePermissions('pi-policy.manage')
  @Get()
  list(@Query() query: ListPiRiskEventsQueryDto) {
    return this.events.list(query);
  }

  @RequirePermissions('pi-policy.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.events.get(id);
  }

  @RequirePermissions('pi-policy.manage')
  @Post(':id/mitigation')
  recordMitigation(
    @Param('id') id: string,
    @Body() dto: RecordPiRiskEventMitigationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.events.recordMitigation(id, dto, user.id);
  }
}
