import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmployeePerformanceService } from './employee-performance.service';
import { ComputeEmployeePerformanceDto } from './dto/compute-employee-performance.dto';
import { ListEmployeePerformanceQueryDto } from './dto/list-employee-performance-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 61 — `employee-performance.view` (already pre-seeded, Manager/
 * Executive) gates every route here, including the manual recompute
 * trigger: no separate "manage" permission exists for this process. `POST
 * /compute` recomputes ONE employee (the `up-sell-recommendations/detect` /
 * #60 `insurer-performance/compute` shape) — recomputing every employee
 * with a linked account is the monthly scheduler's own job, never exposed
 * as an HTTP "run for everybody" trigger.
 */
@ApiTags('management-reporting')
@Controller('employee-performance')
export class EmployeePerformanceController {
  constructor(private readonly performance: EmployeePerformanceService) {}

  @RequirePermissions('employee-performance.view')
  @Post('compute')
  async compute(
    @Body() dto: ComputeEmployeePerformanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const period = this.performance.resolvePeriodFromDto(dto);
    return this.performance.computeRecordForEmployee(
      dto.employeeId,
      period,
      user.id,
    );
  }

  @RequirePermissions('employee-performance.view')
  @Get()
  list(@Query() query: ListEmployeePerformanceQueryDto) {
    return this.performance.list(query);
  }

  @RequirePermissions('employee-performance.view')
  @Get(':employeeId/latest')
  latest(@Param('employeeId') employeeId: string) {
    return this.performance.latest(employeeId);
  }
}
