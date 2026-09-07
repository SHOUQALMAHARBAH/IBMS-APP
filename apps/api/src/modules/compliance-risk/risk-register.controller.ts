import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RiskRegisterService } from './risk-register.service';
import { CreateRiskRegisterItemDto } from './dto/create-risk-register-item.dto';
import { UpdateRiskRegisterMitigationDto } from './dto/update-risk-register-mitigation.dto';
import { ListRiskRegisterQueryDto } from './dto/list-risk-register-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 53 (backlog Part C #53-54's first checkbox) — the broker's own
 * generic risk register. `risk-register.manage`
 * (`[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER]`) gates every route.
 */
@ApiTags('compliance-risk')
@Controller('risk-register')
export class RiskRegisterController {
  constructor(private readonly register: RiskRegisterService) {}

  @RequirePermissions('risk-register.manage')
  @Post()
  create(
    @Body() dto: CreateRiskRegisterItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.register.create(dto, user.id);
  }

  @RequirePermissions('risk-register.manage')
  @Get()
  list(@Query() query: ListRiskRegisterQueryDto) {
    return this.register.list(query);
  }

  @RequirePermissions('risk-register.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.register.get(id);
  }

  @RequirePermissions('risk-register.manage')
  @Post(':id/mitigation')
  recordMitigation(
    @Param('id') id: string,
    @Body() dto: UpdateRiskRegisterMitigationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.register.recordMitigation(id, dto, user.id);
  }

  @RequirePermissions('risk-register.manage')
  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.register.close(id, user.id);
  }
}
