import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClaimService } from './claim.service';
import { NotifyClaimDto } from './dto/notify-claim.dto';
import { RegisterClaimDto } from './dto/register-claim.dto';
import { ListClaimsQueryDto } from './dto/list-claims-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 23-24 — Claim Notification + Registration (backlog Part C #23-24,
 * Domain C). Record a reported loss against a Policy — loss date/location/cause,
 * the estimated loss, third-party involvement — with server-side validation
 * that cover was in force at the exact loss date (against the policy's
 * `PolicySchedule` version windows, not the current schedule alone); then
 * register it with the insurer and assign the loss adjuster, moving it
 * `NOTIFIED → REGISTERED` through the workflow engine. See claim.service.ts for
 * the rules. Frontend: the "Claims" block in the "Policy" section on
 * apps/web/app/(app)/opportunities/[id]/. */
@ApiTags('claims')
@Controller('claims')
export class ClaimController {
  constructor(private readonly claims: ClaimService) {}

  @RequirePermissions('claim.notify')
  @Post()
  notify(@Body() dto: NotifyClaimDto, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.notify(dto, user);
  }

  /** Process 24 — register a NOTIFIED claim with the insurer (recording its
   * reference) and assign the loss adjuster. Drives `Claim NOTIFIED →
   * REGISTERED` through the workflow engine. */
  @RequirePermissions('claim.register')
  @Post(':id/registration')
  register(
    @Param('id') id: string,
    @Body() dto: RegisterClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.register(id, dto, user);
  }

  @RequirePermissions('claim.read')
  @Get()
  list(
    @Query() query: ListClaimsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.list(query, user);
  }

  @RequirePermissions('claim.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.get(id, user);
  }
}
