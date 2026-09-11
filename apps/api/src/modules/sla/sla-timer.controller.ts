import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SlaTimerService } from './sla-timer.service';
import { SlaPolicyRepository } from '../../repositories/sla-policy.repository';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateSlaHolidayDto, PauseSlaTimerDto } from './dto/sla-policy.dto';

/**
 * The running SLA clock: status, pause/resume, and the working calendar the
 * business-day math walks.
 *
 * `sla.policy.read` to look, `sla.timer.pause` to stop or restart a clock.
 * Pausing is separately permissioned because a stopped compliance clock is a
 * consequential act — it is the one thing that can make a breach not look like
 * one — and it always carries a written reason.
 */
@ApiTags('sla')
@Controller('sla')
export class SlaTimerController {
  constructor(
    private readonly timers: SlaTimerService,
    private readonly policies: SlaPolicyRepository,
  ) {}

  /** Where a timer stands, with the provenance of its deadline attached: a
   * screen showing BREACHED needs to say whether what was breached is the law
   * or an internal target. */
  @RequirePermissions('sla.policy.read')
  @Get('timers/:id/status')
  status(@Param('id') id: string) {
    return this.timers.checkSlaStatus(id);
  }

  @RequirePermissions('sla.timer.pause')
  @Post('timers/:id/pause')
  pause(
    @Param('id') id: string,
    @Body() dto: PauseSlaTimerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timers.pause(id, dto.reason, user.id);
  }

  @RequirePermissions('sla.timer.pause')
  @Post('timers/:id/resume')
  resume(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timers.resume(id, user.id);
  }

  /**
   * The public-holiday calendar. `business-days.util.ts` accounted for the
   * weekend only and said a computed deadline should be treated as a LOWER
   * BOUND until a calendar was supplied — this is that calendar, so a
   * business-day deadline can be exact.
   */
  @RequirePermissions('sla.policy.read')
  @Get('holidays')
  listHolidays() {
    return this.policies.findHolidays();
  }

  @RequirePermissions('sla.policy.manage')
  @Post('holidays')
  createHoliday(
    @Body() dto: CreateSlaHolidayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.createHoliday({
      // Parsed as a UTC whole day, matching how `SlaHoliday.observedOn` is
      // stored and how `utcDateKey` looks it up. A local-time parse here would
      // shift the holiday a day for half the world.
      observedOn: new Date(`${dto.observedOn}T00:00:00.000Z`),
      name: dto.name,
      calendarType: dto.calendarType ?? null,
      createdByUserId: user.id,
    });
  }
}
