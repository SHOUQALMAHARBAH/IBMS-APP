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
import { BcpDrPlanService } from './bcp-dr-plan.service';
import { CreateBcpDrPlanDto } from './dto/create-bcp-dr-plan.dto';
import { UpdateBcpDrPlanDto } from './dto/update-bcp-dr-plan.dto';
import { ListBcpDrPlansQueryDto } from './dto/list-bcp-dr-plans-query.dto';
import { RecordBcpDrPlanTestDto } from './dto/record-bcp-dr-plan-test.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 72-73 (backlog Part C #72-73, Domain H) — Business Continuity &
 * Disaster Recovery. `bcp-dr.manage` (already pre-seeded) gates the whole
 * surface. `coverage` is declared before `:id` so it is matched first.
 */
@ApiTags('supporting-operations')
@Controller('bcp-dr-plans')
export class BcpDrPlanController {
  constructor(private readonly plans: BcpDrPlanService) {}

  @RequirePermissions('bcp-dr.manage')
  @Post()
  create(
    @Body() dto: CreateBcpDrPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plans.create(dto, user.id);
  }

  @RequirePermissions('bcp-dr.manage')
  @Get('coverage')
  coverage() {
    return this.plans.coverage();
  }

  @RequirePermissions('bcp-dr.manage')
  @Get()
  list(@Query() query: ListBcpDrPlansQueryDto) {
    return this.plans.list(query);
  }

  @RequirePermissions('bcp-dr.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.plans.get(id);
  }

  @RequirePermissions('bcp-dr.manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBcpDrPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plans.update(id, dto, user.id);
  }

  @RequirePermissions('bcp-dr.manage')
  @Post(':id/record-test')
  recordTest(
    @Param('id') id: string,
    @Body() dto: RecordBcpDrPlanTestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plans.recordTest(id, dto, user.id);
  }
}
