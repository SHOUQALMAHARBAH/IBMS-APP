import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LegalHoldService } from './legal-hold.service';
import { CreateLegalHoldDto } from './dto/create-legal-hold.dto';
import { ListLegalHoldsQueryDto } from './dto/list-legal-holds-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** M06 — `legal-hold.manage` (`[DATA_PROTECTION_OFFICER]`, pre-seeded)
 * gates the whole surface. */
@ApiTags('pdpl')
@Controller('legal-holds')
export class LegalHoldController {
  constructor(private readonly legalHolds: LegalHoldService) {}

  @RequirePermissions('legal-hold.manage')
  @Post()
  create(
    @Body() dto: CreateLegalHoldDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.legalHolds.create(dto, user.id);
  }

  @RequirePermissions('legal-hold.manage')
  @Get()
  list(@Query() query: ListLegalHoldsQueryDto) {
    return this.legalHolds.list(query);
  }

  @RequirePermissions('legal-hold.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.legalHolds.get(id);
  }

  @RequirePermissions('legal-hold.manage')
  @Post(':id/review')
  recordReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.legalHolds.recordReview(id, user.id);
  }

  @RequirePermissions('legal-hold.manage')
  @Post(':id/release')
  release(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.legalHolds.release(id, user.id);
  }
}
