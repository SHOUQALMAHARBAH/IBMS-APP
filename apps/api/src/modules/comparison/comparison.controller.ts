import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ComparisonService } from './comparison.service';
import { BuildComparisonDto } from './dto/build-comparison.dto';
import { ListComparisonQueryDto } from './dto/list-comparison-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 14 — Quote Comparison (backlog Part C #14, Domain B). Build the
 * structured comparison matrix for an RFQ from its current-version
 * quotations, and flag the shortlisted insurers with no quote to compare.
 * See comparison.service.ts for the rules. Frontend: the "Comparison"
 * section on apps/web/app/(app)/rfqs/[id]/. */
@ApiTags('comparison-matrices')
@Controller('comparison-matrices')
export class ComparisonController {
  constructor(private readonly comparisons: ComparisonService) {}

  @RequirePermissions('comparison.build')
  @Post()
  build(
    @Body() dto: BuildComparisonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comparisons.build(dto, user);
  }

  @RequirePermissions('comparison.read')
  @Get()
  get(
    @Query() query: ListComparisonQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comparisons.get(query.rfqId, user);
  }

  @RequirePermissions('comparison.read')
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.comparisons.getById(id, user);
  }
}
