import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IncidentService } from './incident.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { ClassifyIncidentDto } from './dto/classify-incident.dto';
import { NotifyRegulatorsDto } from './dto/notify-regulators.dto';
import { CloseIncidentDto } from './dto/close-incident.dto';
import { ListIncidentsQueryDto } from './dto/list-incidents-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 55/Part 6.2/Part 7.4 (backlog Part C #55) — the unified security +
 * personal-data breach workflow. `incident.report` (broad) gates
 * create/read; `incident.contain` (Admin/Compliance) gates the operational
 * response steps; `incident.classify` (DPO + Executive Management) gates
 * both classification sub-actions, role-checked further inside the service;
 * `incident.notify-regulator` (DPO/Compliance) gates the external filings.
 */
@ApiTags('compliance-risk')
@Controller('incidents')
export class IncidentController {
  constructor(private readonly incidents: IncidentService) {}

  @RequirePermissions('incident.report')
  @Post()
  create(
    @Body() dto: CreateIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidents.create(dto, user.id);
  }

  @RequirePermissions('incident.report')
  @Get()
  list(
    @Query() query: ListIncidentsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidents.list(query, user.id);
  }

  @RequirePermissions('incident.report')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidents.get(id, user.id);
  }

  @RequirePermissions('incident.contain')
  @Post(':id/contain')
  contain(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidents.contain(id, user.id);
  }

  @RequirePermissions('incident.contain')
  @Post(':id/assess-impact')
  assessImpact(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidents.assessImpact(id, user.id);
  }

  @RequirePermissions('incident.classify')
  @Post(':id/classify')
  classify(
    @Param('id') id: string,
    @Body() dto: ClassifyIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidents.classify(id, dto, user);
  }

  @RequirePermissions('incident.classify')
  @Post(':id/co-sign')
  coSign(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidents.coSign(id, user);
  }

  @RequirePermissions('incident.classify')
  @Post(':id/notify-senior-management')
  notifySeniorManagement(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidents.notifySeniorManagement(id, user.id);
  }

  @RequirePermissions('incident.notify-regulator')
  @Post(':id/notify-regulators')
  notifyRegulators(
    @Param('id') id: string,
    @Body() dto: NotifyRegulatorsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidents.notifyRegulators(id, dto, user.id);
  }

  @RequirePermissions('incident.notify-regulator')
  @Post(':id/notify-affected-subjects')
  notifyAffectedSubjects(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidents.notifyAffectedSubjects(id, user.id);
  }

  @RequirePermissions('incident.contain')
  @Post(':id/recover')
  recover(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidents.recover(id, user.id);
  }

  @RequirePermissions('incident.contain')
  @Post(':id/close')
  close(
    @Param('id') id: string,
    @Body() dto: CloseIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidents.close(id, dto, user.id);
  }
}
