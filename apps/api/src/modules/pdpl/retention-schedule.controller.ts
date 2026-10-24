import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RetentionScheduleService } from './retention-schedule.service';
import { CreateRetentionScheduleItemDto } from './dto/create-retention-schedule-item.dto';
import { UpdateRetentionScheduleItemDto } from './dto/update-retention-schedule-item.dto';
import { CombinedDutyDeclarationDto } from '../../common/dto/combined-duty-declaration.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * M06 — the retention-period table, and MODULE 0 CLOSE DECISION 3 split its one code in two.
 *
 * `retention-schedule.manage` gated the whole surface, so one person could set a retention period
 * and confirm it as Legal Counsel with nothing to compare — the confirm step recorded a DATE AND NO
 * ACTOR. It is now `.update` (the maker) and `.confirm` (the checker), registered as the sixteenth
 * maker/checker pair with a database CHECK behind it.
 *
 * THE READS TAKE BOTH CODES, and this is the one place `PermissionsGuard`'s OR semantics is what you
 * want: it ORs what it is given (`required.some`), so either half can see the table — which both
 * halves need. On a WRITE that same OR would be wrong, which is why each write names exactly one.
 */
@ApiTags('pdpl')
@Controller('retention-schedule')
export class RetentionScheduleController {
  constructor(private readonly schedule: RetentionScheduleService) {}

  @RequirePermissions('retention-schedule.update')
  @Post()
  create(
    @Body() dto: CreateRetentionScheduleItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.schedule.create(dto, user.id);
  }

  @RequirePermissions('retention-schedule.update', 'retention-schedule.confirm')
  @Get()
  list() {
    return this.schedule.list();
  }

  @RequirePermissions('retention-schedule.update', 'retention-schedule.confirm')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.schedule.get(id);
  }

  @RequirePermissions('retention-schedule.update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRetentionScheduleItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.schedule.update(id, dto, user.id);
  }

  @RequirePermissions('retention-schedule.confirm')
  @Post(':id/confirm')
  confirm(
    @Param('id') id: string,
    @Body() dto: CombinedDutyDeclarationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    /*
     * The declaration is an OPTIONAL body field, so an ordinary two-person confirmation sends nothing
     * and behaves exactly as before. A DTO cannot see the office's declared mode, so whether a reason
     * is REQUIRED is decided in the service — the shape all sixteen siblings use.
     */
    return this.schedule.confirm(id, user.id, dto);
  }
}
