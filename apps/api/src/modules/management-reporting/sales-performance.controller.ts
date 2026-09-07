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
import { SalesPerformanceService } from './sales-performance.service';
import { CreateSalesTargetDto } from './dto/create-sales-target.dto';
import { UpdateSalesTargetDto } from './dto/update-sales-target.dto';
import { ListSalesTargetQueryDto } from './dto/list-sales-target-query.dto';
import { SalesPerformanceQueryDto } from './dto/sales-performance-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 59 (backlog Part C #59) — `sales-target.manage` (Manager/
 * Executive) gates the raw `SalesTarget` registry; `dashboard.sales.view`
 * (already pre-seeded — Sales/Relationship Officer, Manager, Executive)
 * gates the resolved performance-vs-target read.
 */
@ApiTags('management-reporting')
@Controller()
export class SalesPerformanceController {
  constructor(private readonly performance: SalesPerformanceService) {}

  @RequirePermissions('sales-target.manage')
  @Post('sales-targets')
  createTarget(
    @Body() dto: CreateSalesTargetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.performance.createTarget(dto, user.id);
  }

  @RequirePermissions('sales-target.manage')
  @Patch('sales-targets/:id')
  updateTarget(
    @Param('id') id: string,
    @Body() dto: UpdateSalesTargetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.performance.updateTarget(id, dto, user.id);
  }

  @RequirePermissions('sales-target.manage')
  @Get('sales-targets/:id')
  getTarget(@Param('id') id: string) {
    return this.performance.getTarget(id);
  }

  @RequirePermissions('sales-target.manage')
  @Get('sales-targets')
  listTargets(@Query() query: ListSalesTargetQueryDto) {
    return this.performance.listTargets(query);
  }

  @RequirePermissions('dashboard.sales.view')
  @Get('sales-performance')
  report(
    @Query() query: SalesPerformanceQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.performance.report(query, user);
  }
}
