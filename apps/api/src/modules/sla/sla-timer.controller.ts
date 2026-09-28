import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SlaTimerService } from './sla-timer.service';
import { SlaPolicyRepository } from '../../repositories/sla-policy.repository';
import { SlaPolicyService } from './sla-policy.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AddMovingHolidayDto,
  CreateSlaHolidayDto,
  PauseSlaTimerDto,
} from './dto/sla-policy.dto';

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
    private readonly policyService: SlaPolicyService,
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

  /**
   * One year of the calendar and what it still owes — the read a per-year screen is
   * built on. Declared BEFORE `holidays/:something` would be if one is ever added:
   * Nest matches in declaration order and a literal behind a parameter route is
   * unreachable.
   */
  @RequirePermissions('sla.policy.read')
  @Get('holidays/year/:year')
  holidayYear(@Param('year', ParseIntPipe) year: number) {
    return this.policyService.holidayCalendarForYear(year);
  }

  /** Fill in the four fixed-date holidays for a year. Idempotent — it creates only
   * what is missing, because two people opening the same year is ordinary. */
  @RequirePermissions('sla.holiday.create')
  @Post('holidays/year/:year/fixed')
  addFixedHolidays(
    @Param('year', ParseIntPipe) year: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policyService.createFixedHolidaysForYear(year, user);
  }

  /**
   * Enter a moving occasion from the year's official announcement: a start date, which
   * the server expands to the occasion's own length (Eid al-Adha is five days, Eid
   * al-Fitr four). The length comes from the vocabulary rather than the request so an
   * officer does not have to remember which is which.
   *
   * The DATE is never computed. Jordan's Islamic holidays are set by announcement and
   * can differ by a day from any calendar conversion.
   */
  @RequirePermissions('sla.holiday.create')
  @Post('holidays/occasion')
  addOccasion(
    @Body() dto: AddMovingHolidayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policyService.createMovingOccasion(
      dto.occasionKey,
      dto.startDate,
      user,
    );
  }

  @RequirePermissions('sla.holiday.create')
  @Post('holidays')
  createHoliday(
    @Body() dto: CreateSlaHolidayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Through the SERVICE, not the repository: a duplicate date has to come back
    // as a 409 naming the day rather than an unhandled P2002, and adding a
    // holiday has to be audited — one holiday row moves every business-day
    // deadline in the office.
    return this.policyService.createHoliday(
      {
        // Parsed as a UTC whole day, matching how `SlaHoliday.observedOn` is
        // stored and how `utcDateKey` looks it up. A local-time parse here would
        // shift the holiday a day for half the world.
        observedOn: new Date(`${dto.observedOn}T00:00:00.000Z`),
        name: dto.name,
        calendarType: dto.calendarType ?? null,
      },
      user,
    );
  }
}
