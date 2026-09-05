import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { QuotationService } from './quotation.service';
import { CaptureQuotationDto } from './dto/capture-quotation.dto';
import { ReviseQuotationDto } from './dto/revise-quotation.dto';
import { ListQuotationsQueryDto } from './dto/list-quotations-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 13 — Quotation Management (backlog Part C #13, Domain B). Capture
 * an insurer's quote against one RFQ line, and version it on every
 * renegotiation (never overwrite). See quotation.service.ts for the rules.
 * Frontend: the "Quotations" section on apps/web/app/(app)/rfqs/[id]/. */
@ApiTags('quotations')
@Controller('quotations')
export class QuotationController {
  constructor(private readonly quotations: QuotationService) {}

  @RequirePermissions('quotation.capture')
  @Post()
  capture(
    @Body() dto: CaptureQuotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quotations.capture(dto, user);
  }

  @RequirePermissions('quotation.read')
  @Get()
  list(
    @Query() query: ListQuotationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quotations.list(query, user);
  }

  @RequirePermissions('quotation.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.quotations.get(id, user);
  }

  /** Record a renegotiation round as a NEW version of the quotation at
   * `:id` (which must be the chain's current version). */
  @RequirePermissions('quotation.negotiate')
  @Post(':id/revise')
  revise(
    @Param('id') id: string,
    @Body() dto: ReviseQuotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quotations.revise(id, dto, user);
  }
}
