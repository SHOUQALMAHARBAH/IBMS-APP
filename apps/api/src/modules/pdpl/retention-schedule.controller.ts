import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RetentionScheduleService } from './retention-schedule.service';
import { CreateRetentionScheduleItemDto } from './dto/create-retention-schedule-item.dto';
import { UpdateRetentionScheduleItemDto } from './dto/update-retention-schedule-item.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** M06 — the retention-period table. `retention-schedule.manage`
 * (`[COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER]`) gates the whole
 * surface — a genuinely new permission, not pre-seeded ahead of time the
 * way the disposal/legal-hold actions were. */
@ApiTags('pdpl')
@Controller('retention-schedule')
export class RetentionScheduleController {
  constructor(private readonly schedule: RetentionScheduleService) {}

  @RequirePermissions('retention-schedule.manage')
  @Post()
  create(
    @Body() dto: CreateRetentionScheduleItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.schedule.create(dto, user.id);
  }

  @RequirePermissions('retention-schedule.manage')
  @Get()
  list() {
    return this.schedule.list();
  }

  @RequirePermissions('retention-schedule.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.schedule.get(id);
  }

  @RequirePermissions('retention-schedule.manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRetentionScheduleItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.schedule.update(id, dto, user.id);
  }

  @RequirePermissions('retention-schedule.manage')
  @Post(':id/confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.schedule.confirm(id, user.id);
  }
}
