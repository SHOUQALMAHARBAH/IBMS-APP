import { Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RefundService } from './refund.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 31–32 — Refund disbursement (backlog Part C #31–32, gap 3.2).
 * Standalone refund raise (`POST /refunds`) is documented future work
 * (requires schema migration: Refund.endorsementId nullable).
 */
@ApiTags('refunds')
@Controller('refunds')
export class RefundController {
  constructor(private readonly refunds: RefundService) {}

  /**
   * Mark a refund as disbursed (payment executed). Refund must exist and not
   * already be marked paid. Audit trail recorded. No `ClientFundsLedgerEntry`
   * is created here — that is the responsibility of the caller's financial
   * flow (e.g., a `PaymentProcessingService` or a reconciliation). */
  @RequirePermissions('refund.disburse')
  @Post(':id/disburse')
  disburse(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.refunds.disburse(id, user);
  }
}
