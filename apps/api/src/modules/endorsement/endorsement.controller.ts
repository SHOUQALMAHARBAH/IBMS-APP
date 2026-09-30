import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EndorsementService } from './endorsement.service';
import { CreateEndorsementDto } from './dto/create-endorsement.dto';
import { CreateCancellationDto } from './dto/create-cancellation.dto';
import {
  AdvanceEndorsementDto,
  CalculateAdjustmentDto,
} from './dto/endorsement-step.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DiscardDto } from '../../common/dto/discard.dto';
import { ApproveRefundDto } from './dto/approve-refund.dto';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 22 — Endorsement Management (backlog Part C #22, Domain B). Raise
 * and work a positive/negative mid-term endorsement or a cancellation on an
 * ACTIVE policy: the premium adjustment, the auto-tied commission reversal, a
 * maker/checker-gated refund, and a new (never-overwritten) coverage-schedule
 * version at APPLY. See endorsement.service.ts for the rules. Frontend: the
 * "Endorsements" block in the "Policy" section on
 * apps/web/app/(app)/opportunities/[id]/. */
@ApiTags('endorsements')
@Controller()
export class EndorsementController {
  constructor(private readonly endorsements: EndorsementService) {}

  @RequirePermissions('endorsement.create')
  @Post('policies/:policyId/endorsements')
  request(
    @Param('policyId') policyId: string,
    @Body() dto: CreateEndorsementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.endorsements.requestEndorsement(policyId, dto, user);
  }

  @RequirePermissions('cancellation.create')
  @Post('policies/:policyId/cancellation')
  cancel(
    @Param('policyId') policyId: string,
    @Body() dto: CreateCancellationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.endorsements.requestCancellation(policyId, dto, user);
  }

  @RequirePermissions('endorsement.read')
  @Get('policies/:policyId/endorsements')
  list(
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.endorsements.list(policyId, user);
  }

  @RequirePermissions('endorsement.read')
  @Get('endorsements/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.endorsements.get(id, user);
  }

  /** One hop: REQUESTED → SUBMITTED_TO_INSURER → INSURER_CONFIRMED. */
  @RequirePermissions('endorsement.create')
  @Post('endorsements/:id/advance')
  advance(
    @Param('id') id: string,
    @Body() dto: AdvanceEndorsementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.endorsements.advance(id, dto, user);
  }

  /** INSURER_CONFIRMED → FINANCIAL_ADJUSTMENT_CALCULATED — finalises the
   * money and (for a negative endorsement) creates the auto-tied
   * CommissionReversal + the maker-side Refund. */
  @RequirePermissions('endorsement.apply')
  @Post('endorsements/:id/calculate-adjustment')
  calculate(
    @Param('id') id: string,
    @Body() dto: CalculateAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.endorsements.calculateAdjustment(id, dto, user);
  }

  /** FINANCIAL_ADJUSTMENT_CALCULATED → APPLIED (positive / below-threshold
   * negative) — versions the coverage schedule. */
  @RequirePermissions('endorsement.apply')
  @Post('endorsements/:id/apply')
  apply(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.endorsements.apply(id, user);
  }

  /** Maker/checker refund approval (never the raiser). Advances the
   * endorsement REFUND_APPROVAL_PENDING → APPLIED. */
  @RequirePermissions('refund.approve')
  @Post('refunds/:id/approve')
  approveRefund(
    @Param('id') id: string,
    @Body() dto: ApproveRefundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.endorsements.approveRefund(id, dto, user);
  }

  /** APPLIED → CLIENT_NOTIFIED. */
  @RequirePermissions('endorsement.apply')
  @Post('endorsements/:id/notify-client')
  notify(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.endorsements.notifyClient(id, user);
  }
  /**
   * Mark this endorsement as raised in error. Terminal, reason mandatory, and refused once the endorsement has been
   * applied — the record stays either way.
   *
   * ONE permission code, not two. `PermissionsGuard` ORs what it is given, so
   * `@RequirePermissions('endorsement.discard', 'endorsement.create')` would let a holder of EITHER through alone,
   * which is the opposite of the intent.
   */
  @RequirePermissions('endorsement.discard')
  @Post('endorsements/:id/discard')
  discard(
    @Param('id') id: string,
    @Body() dto: DiscardDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.endorsements.discard(id, dto, user);
  }
}
