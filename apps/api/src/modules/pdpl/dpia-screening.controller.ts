import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DpiaScreeningService } from './dpia-screening.service';
import { CreateDpiaScreeningDto } from './dto/create-dpia-screening.dto';
import { ListDpiaScreeningsQueryDto } from './dto/list-dpia-screenings-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** M10 — DPIA Screening. `dpia.review` (DPO-only) gates the whole surface —
 * see `dpia-screening.config.ts`'s header comment for why. */
@ApiTags('pdpl')
@Controller('dpia-screenings')
export class DpiaScreeningController {
  constructor(private readonly dpia: DpiaScreeningService) {}

  @RequirePermissions('dpia.review')
  @Post()
  create(
    @Body() dto: CreateDpiaScreeningDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dpia.create(dto, user.id);
  }

  @RequirePermissions('dpia.review')
  @Get()
  list(@Query() query: ListDpiaScreeningsQueryDto) {
    return this.dpia.list(query);
  }

  @RequirePermissions('dpia.review')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.dpia.get(id);
  }

  @RequirePermissions('dpia.review')
  @Post(':id/review')
  recordReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dpia.recordReview(id, user.id);
  }

  @RequirePermissions('dpia.review')
  @Post(':id/spot-check')
  recordSpotCheck(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dpia.recordSpotCheck(id, user.id);
  }

  @RequirePermissions('dpia.review')
  @Post(':id/escalate')
  escalate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dpia.escalateToFullDpia(id, user.id);
  }
}
