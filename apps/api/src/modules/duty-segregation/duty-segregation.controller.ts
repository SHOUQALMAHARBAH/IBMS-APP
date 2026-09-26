import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DutySegregationModeService } from './duty-segregation-mode.service';
import { DeclareDutySegregationModeDto } from './dto/declare-mode.dto';

/**
 * Part 4 step 4 — reading and declaring this office's duty-segregation mode.
 *
 * The READ is gated on either code deliberately: `PermissionsGuard` ORs what it is given, which is wrong for a
 * write and exactly right here. Whoever declares the mode needs to see it, and so does whoever reviews the
 * acts it permits — and those are different people on purpose (`duty-segregation.mode.declare` is the office
 * administrator's; `internal-controls.view` is Compliance, Executive and the external auditor's).
 *
 * The WRITE names one code, because an OR there would let either party through alone.
 */
@ApiTags('duty-segregation')
@Controller('duty-segregation')
export class DutySegregationController {
  constructor(private readonly mode: DutySegregationModeService) {}

  @RequirePermissions('duty-segregation.mode.declare', 'internal-controls.view')
  @Get('mode')
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.mode.get(user);
  }

  @RequirePermissions('duty-segregation.mode.declare')
  @Patch('mode')
  declare(
    @Body() dto: DeclareDutySegregationModeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mode.declare(dto.mode, dto.reason, user);
  }
}
