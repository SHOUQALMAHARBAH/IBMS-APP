import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ComplianceCalendarService } from './compliance-calendar.service';
import { CreateComplianceCalendarItemDto } from './dto/create-compliance-calendar-item.dto';
import { RecordComplianceSubmissionDto } from './dto/record-compliance-submission.dto';
import { ListComplianceCalendarQueryDto } from './dto/list-compliance-calendar-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 51/Part 7.1 (backlog Part C #51's second checkbox) — the CBJ
 * regulatory compliance calendar. `compliance-calendar.manage`
 * (`[COMPLIANCE_OFFICER]`) gates every route.
 */
@ApiTags('compliance-risk')
@Controller('compliance-calendar')
export class ComplianceCalendarController {
  constructor(private readonly calendar: ComplianceCalendarService) {}

  @RequirePermissions('compliance-calendar.manage')
  @Post()
  create(
    @Body() dto: CreateComplianceCalendarItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.calendar.create(dto, user.id);
  }

  @RequirePermissions('compliance-calendar.manage')
  @Get()
  list(@Query() query: ListComplianceCalendarQueryDto) {
    return this.calendar.list(query);
  }

  @RequirePermissions('compliance-calendar.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.calendar.get(id);
  }

  @RequirePermissions('compliance-calendar.manage')
  @Post(':id/record-submission')
  recordSubmission(
    @Param('id') id: string,
    @Body() dto: RecordComplianceSubmissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.calendar.recordSubmission(id, dto, user.id);
  }
}
