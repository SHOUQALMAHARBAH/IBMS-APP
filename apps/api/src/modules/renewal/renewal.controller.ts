import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RenewalService } from './renewal.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TransitionRenewalCaseDto } from './dto/transition-renewal-case.dto';
import { SetRenewalFlagsDto } from './dto/set-renewal-flags.dto';

/**
 * Part 3.9 — Renewal Management.
 *
 *   - `POST /renewal-cases/detect` — run the lead-time sweep on demand
 *     (the nightly `RenewalScheduler` calls the same service method).
 *   - `GET /renewal-cases?customerId=|policyId=` + `/:id`
 *   - `POST /renewal-cases/:id/transition` — walk `RenewalStatus`.
 *   - `PATCH /renewal-cases/:id/flags` — the two re-marketing triggers.
 *
 * No `AuthModule` import — the global `PermissionsGuard` / `@CurrentUser`
 * cover it (the `CrmModule` / `KpiDashboardController` pattern).
 */
@ApiTags('renewal')
@Controller('renewal-cases')
export class RenewalController {
  constructor(private readonly renewal: RenewalService) {}

  @RequirePermissions('renewal.manage')
  @Post('detect')
  detect(@CurrentUser() user: AuthenticatedUser) {
    return this.renewal.runSweep(user.id);
  }

  @RequirePermissions('renewal.read')
  @Get()
  list(
    @Query('customerId') customerId?: string,
    @Query('policyId') policyId?: string,
  ) {
    return this.renewal.list({ customerId, policyId });
  }

  @RequirePermissions('renewal.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.renewal.get(id);
  }

  @RequirePermissions('renewal.manage')
  @Post(':id/transition')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionRenewalCaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.renewal.transition(id, dto.toStatus, user.id);
  }

  @RequirePermissions('renewal.manage')
  @Patch(':id/flags')
  setFlags(
    @Param('id') id: string,
    @Body() dto: SetRenewalFlagsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.renewal.setFlags(id, dto, user.id);
  }
}
