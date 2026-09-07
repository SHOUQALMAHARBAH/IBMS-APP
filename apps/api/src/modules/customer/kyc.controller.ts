import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { KycService } from './kyc.service';
import { KycDecisionDto } from './dto/kyc-decision.dto';
import { ScheduleReviewDto } from './dto/schedule-review.dto';
import { ListKycRecordsQueryDto } from './dto/list-kyc-records-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 3-4 — the KYC lifecycle (see kyc.service.ts for the full status
 * chain). Frontend: apps/web/app/(app)/customers/kyc-queue (Compliance
 * queue) and the KYC wizard's submit step. */
@ApiTags('kyc-records')
@Controller()
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @RequirePermissions('kyc.capture')
  @Post('customers/:customerId/kyc')
  start(
    @Param('customerId') customerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kyc.start(customerId, user.id);
  }

  @RequirePermissions('kyc.capture')
  @Post('kyc-records/:id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.kyc.submit(id, user.id);
  }

  @RequirePermissions('screening.run')
  @Post('kyc-records/:id/run-screening')
  runScreening(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kyc.runScreening(id, user.id);
  }

  @RequirePermissions('screening.run')
  @Post('kyc-records/:id/rerun-screening')
  rerunScreening(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kyc.rerunScreening(id, user.id);
  }

  @RequirePermissions('kyc.edd.trigger')
  @Post('kyc-records/:id/trigger-edd')
  triggerEdd(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.kyc.triggerEdd(id, user.id);
  }

  @RequirePermissions('kyc.approve')
  @Post('kyc-records/:id/approve')
  approve(
    @Param('id') id: string,
    @Body() dto: KycDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kyc.decide(id, 'APPROVED', dto.reason, user.id);
  }

  @RequirePermissions('kyc.approve')
  @Post('kyc-records/:id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: KycDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kyc.decide(id, 'REJECTED', dto.reason, user.id);
  }

  @RequirePermissions('kyc.review.schedule')
  @Post('kyc-records/:id/schedule-review')
  scheduleReview(
    @Param('id') id: string,
    @Body() dto: ScheduleReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kyc.scheduleReview(id, dto, user.id);
  }

  @RequirePermissions('kyc.capture', 'kyc.approve')
  @Get('kyc-records')
  list(
    @Query() query: ListKycRecordsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kyc.list(query, user);
  }

  @RequirePermissions('kyc.capture', 'kyc.approve')
  @Get('kyc-records/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.kyc.get(id, user);
  }
}
