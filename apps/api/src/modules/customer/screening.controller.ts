import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ScreeningService } from './screening.service';
import { ScreeningMatchService } from './screening-match.service';
import { ReviewScreeningMatchDto } from './dto/review-screening-match.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 49 — the on-demand trigger for the recurring sanctions/PEP
 * re-screen batch (it is otherwise every 4 hours,
 * `ScreeningBatchScheduler`). Book-wide, not scoped to one customer/KYC
 * record — a separate small controller from `KycController` for that
 * reason. `sanctions-pep.screen` (`[COMPLIANCE_OFFICER]`) — the seeded
 * permission's own description, "Run recurring sanctions/PEP screening
 * batches." */
@ApiTags('kyc-records')
@Controller('screening')
export class ScreeningController {
  constructor(
    private readonly screening: ScreeningService,
    private readonly matches: ScreeningMatchService,
  ) {}

  @RequirePermissions('sanctions-pep.screen')
  @Post('recurring-batch')
  runRecurringBatch(@CurrentUser() user: AuthenticatedUser) {
    return this.screening.runRecurringBatch(user.id);
  }

  /** The review queue. Defaults to `pending` — the work to be done — rather
   * than every match ever recorded. */
  @RequirePermissions('sanctions-pep.screen')
  @Get('matches')
  listMatches(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('kycRecordId') kycRecordId?: string,
  ) {
    return this.matches.list(
      { status: status ?? 'pending', kycRecordId },
      user,
    );
  }

  /** A count for a dashboard badge, without pulling Highly Confidential rows
   * (and so without an `isSensitiveDataAccess` read). */
  @RequirePermissions('sanctions-pep.screen')
  @Get('matches/pending-count')
  pendingCount() {
    return this.matches.pendingCount();
  }

  /** Clear a false positive, or confirm a true match. Both need a written
   * reason; neither is reversible here — a recorded decision stands. */
  @RequirePermissions('sanctions-pep.screen')
  @Post('matches/:id/review')
  reviewMatch(
    @Param('id') id: string,
    @Body() dto: ReviewScreeningMatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.matches.decide(id, dto.decision, dto.reviewReason, user);
  }
}
