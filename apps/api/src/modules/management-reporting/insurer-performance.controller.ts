import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InsurerPerformanceService } from './insurer-performance.service';
import { ComputeInsurerPerformanceDto } from './dto/compute-insurer-performance.dto';
import { ListInsurerPerformanceQueryDto } from './dto/list-insurer-performance-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 60 — `insurer-performance.view` (already pre-seeded, Manager/
 * Executive) gates every route here, including the manual recompute
 * trigger: no separate "manage" permission exists for this process, and
 * this session's audience for triggering an on-demand recompute is the
 * same audience who views the scores. `POST /compute` recomputes ONE
 * insurer (the `up-sell-recommendations/detect` shape) — recomputing every
 * insurer in the book is the monthly scheduler's own job, never exposed as
 * an HTTP "run for everybody" trigger.
 */
@ApiTags('management-reporting')
@Controller('insurer-performance')
export class InsurerPerformanceController {
  constructor(private readonly performance: InsurerPerformanceService) {}

  @RequirePermissions('insurer-performance.view')
  @Post('compute')
  async compute(
    @Body() dto: ComputeInsurerPerformanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const period = this.performance.resolvePeriodFromDto(dto);
    return this.performance.computeScoreForInsurer(
      dto.insurerId,
      period,
      user.id,
    );
  }

  @RequirePermissions('insurer-performance.view')
  @Get()
  list(@Query() query: ListInsurerPerformanceQueryDto) {
    return this.performance.list(query);
  }

  @RequirePermissions('insurer-performance.view')
  @Get(':insurerId/latest')
  latest(@Param('insurerId') insurerId: string) {
    return this.performance.latest(insurerId);
  }
}
