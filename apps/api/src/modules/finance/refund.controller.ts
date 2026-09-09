import { Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RefundService } from './refund.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 37 — Refund disbursement (`IMPROVEMENTS.md` §3.2). The maker
 * (raise) and checker (approve) steps live on the Process 22 endorsement
 * flow; this is the payment-execution step.
 *
 * Standalone refund raise (`POST /refunds`, the seeded-but-unwired
 * `refund.raise`) remains documented future work — it needs
 * `Refund.endorsementId` to become nullable, since today every refund is
 * anchored to the endorsement whose premium adjustment created it.
 */
@ApiTags('refunds')
@Controller('refunds')
export class RefundController {
  constructor(private readonly refunds: RefundService) {}

  /**
   * Execute the refund payment: stamp `paidAt` and book the `out`
   * `ClientFundsLedgerEntry` in one transaction. Refuses an unapproved
   * at/above-threshold refund (maker/checker) and one whose endorsement was
   * never APPLIED. See `RefundService.disburse`. */
  @RequirePermissions('refund.disburse')
  @Post(':id/disburse')
  disburse(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.refunds.disburse(id, user);
  }
}
