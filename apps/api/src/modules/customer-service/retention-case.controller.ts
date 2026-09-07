import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RetentionCaseService } from './retention-case.service';
import { CreateRetentionCaseDto } from './dto/create-retention-case.dto';
import { ListRetentionCasesQueryDto } from './dto/list-retention-cases-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 46 (backlog Part C #46, Domain E — closes the domain) — Customer
 * Retention. Opens automatically on renewal inactivity or lapse risk
 * (`POST :id/sweep` — otherwise nightly), or manually; close once resolved.
 * Every route is `retention-case.manage`
 * (`[SALES_RELATIONSHIP_OFFICER, BRANCH_DEPARTMENT_MANAGER]`) — the global
 * `PermissionsGuard` + `@CurrentUser` cover it, no `AuthModule` import.
 */
@ApiTags('customer-service')
@Controller('retention-cases')
export class RetentionCaseController {
  constructor(private readonly retentionCases: RetentionCaseService) {}

  @RequirePermissions('retention-case.manage')
  @Post()
  create(
    @Body() dto: CreateRetentionCaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.retentionCases.create(dto, user.id);
  }

  /** Run the renewal-inactivity / lapse-risk detection sweep now (it is
   * otherwise nightly). Returns counts only, no case content. Declared
   * before the `:id` routes so `sweep` is never read as a retention-case
   * id. */
  @RequirePermissions('retention-case.manage')
  @Post('sweep')
  runSweep(@CurrentUser() user: AuthenticatedUser) {
    return this.retentionCases.runSweep(user.id);
  }

  @RequirePermissions('retention-case.manage')
  @Get()
  list(@Query() query: ListRetentionCasesQueryDto) {
    return this.retentionCases.list(query);
  }

  @RequirePermissions('retention-case.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.retentionCases.get(id);
  }

  @RequirePermissions('retention-case.manage')
  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.retentionCases.close(id, user.id);
  }
}
