import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DutySegregationModeService } from './duty-segregation-mode.service';
import { DpoDesignationService } from './dpo-designation.service';
import { DeclareDutySegregationModeDto } from './dto/declare-mode.dto';
import { RecordDpoDesignationDto } from './dto/record-dpo-designation.dto';

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
  constructor(
    private readonly mode: DutySegregationModeService,
    private readonly dpo: DpoDesignationService,
  ) {}

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

  /**
   * MODULE 0-ب — the data-protection-officer designation.
   *
   * THE READ IS THE SAME OR AS THE MODE'S, and for the same reason: whoever records the designation
   * needs to see it, and so does whoever reviews the acts a combined posture permits. Those are
   * different people on purpose.
   *
   * THE WRITE NAMES ONE CODE, because an OR there would let either party through alone. NO CODE WAS
   * MINTED for it — `duty-segregation.mode.declare` is held by `OFFICE_ADMINISTRATOR` alone and
   * recording a designation is the same administrative act by the same person on the same screen.
   * That reuse widens what the code does and is reported rather than slipped in.
   */
  @RequirePermissions('duty-segregation.mode.declare', 'internal-controls.view')
  @Get('dpo-designation')
  getDpoDesignation(@CurrentUser() user: AuthenticatedUser) {
    return this.dpo.get(user);
  }

  @RequirePermissions('duty-segregation.mode.declare')
  @Patch('dpo-designation')
  recordDpoDesignation(
    @Body() dto: RecordDpoDesignationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dpo.record(
      dto.dataProtectionOfficerName ?? null,
      dto.combinedAssignmentDeclaration,
      user,
    );
  }
}
