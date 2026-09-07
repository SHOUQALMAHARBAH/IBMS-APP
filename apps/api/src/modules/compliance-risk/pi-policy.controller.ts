import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PiPolicyService } from './pi-policy.service';
import { CreatePiPolicyDto } from './dto/create-pi-policy.dto';
import { RecordPiClaimsHistoryDto } from './dto/record-pi-claims-history.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 53-54/Part 7.1 (backlog Part C #53-54's second checkbox) — the
 * broker's own Professional Indemnity policy. `pi-policy.manage`
 * (`[COMPLIANCE_OFFICER]`) gates every route. `current` is declared before
 * `:id` so the literal path segment wins the route match (the
 * `retention-cases/sweep` shape).
 */
@ApiTags('compliance-risk')
@Controller('pi-policy')
export class PiPolicyController {
  constructor(private readonly policies: PiPolicyService) {}

  @RequirePermissions('pi-policy.manage')
  @Post()
  create(
    @Body() dto: CreatePiPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.create(dto, user.id);
  }

  @RequirePermissions('pi-policy.manage')
  @Get('current')
  getCurrent() {
    return this.policies.getCurrent();
  }

  @RequirePermissions('pi-policy.manage')
  @Get()
  list() {
    return this.policies.list();
  }

  @RequirePermissions('pi-policy.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.policies.get(id);
  }

  @RequirePermissions('pi-policy.manage')
  @Post(':id/claims-history')
  recordClaimsHistory(
    @Param('id') id: string,
    @Body() dto: RecordPiClaimsHistoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.recordClaimsHistory(id, dto, user.id);
  }
}
