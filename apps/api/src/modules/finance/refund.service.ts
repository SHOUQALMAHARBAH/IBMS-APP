import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { EndorsementRepository } from '../../repositories/endorsement.repository';
import type { AuthenticatedUser } from '../auth/auth.types';
import { formatMoney, quantizeMoney } from '../../common/money.util';
import { refundNeedsApproval } from '../endorsement/endorsement.config';

export interface RefundDisbursementView {
  id: string;
  endorsementId: string;
  amount: string;
  paidAt: string;
  clientFundsLedgerEntryId: string;
}

/**
 * Process 37 — refund disbursement (`IMPROVEMENTS.md` §3.2: "`Refund.paidAt`
 * is never written — there is no disbursement step").
 *
 * A `Refund` is minted (maker side) by a negative/cancellation `Endorsement`
 * in `POST /endorsements/:id/calculate-adjustment` and approved (checker
 * side) in `POST /refunds/:id/approve` — both Process 22. This is the third
 * and final step: the money actually leaves the client-funds account.
 *
 * Three controls make that safe, and all three are load-bearing:
 *
 *  1. **The approval gate is re-derived from live data**, never trusted from
 *     the endorsement flow's own snapshot — `refundNeedsApproval(amount)` is
 *     recomputed here and an at/above-threshold refund with no
 *     `approvedByUserId` is refused. Without it this endpoint would be a
 *     maker/checker bypass: real money out with nobody having approved it.
 *     (The #22 `applyCore` "re-check the approval structurally at the write"
 *     rule, applied to the payment step.)
 *  2. **The endorsement must actually have been applied.** A refund whose
 *     endorsement never reached APPLIED describes a premium adjustment that
 *     was never made to the policy — paying it would return premium the
 *     client is still being charged.
 *  3. **The stamp and the ledger movement are one transaction**, with the
 *     stamp status-conditional on `paidAt: null` — the same shape the `in`
 *     side (`recordReceiptWithLedger`) already uses.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly endorsements: EndorsementRepository,
    private readonly audit: AuditService,
  ) {}

  async disburse(
    refundId: string,
    actor: AuthenticatedUser,
  ): Promise<RefundDisbursementView> {
    const refund = await this.endorsements.findRefundById(refundId);
    if (!refund) throw new NotFoundException(`Refund ${refundId} not found.`);

    if (refund.paidAt !== null) {
      throw new ConflictException(
        `Refund ${refundId} was already disbursed on ${refund.paidAt.toISOString()}. A refund is paid once — there is no re-payment path.`,
      );
    }

    const endorsement = refund.endorsement;
    if (
      endorsement.status !== 'APPLIED' &&
      endorsement.status !== 'CLIENT_NOTIFIED'
    ) {
      throw new UnprocessableEntityException(
        `Endorsement ${endorsement.id} is ${endorsement.status}; a refund is disbursed only once its premium adjustment has been APPLIED to the policy.`,
      );
    }

    const amount = quantizeMoney(refund.amount);
    if (refundNeedsApproval(amount) && refund.approvedByUserId === null) {
      throw new UnprocessableEntityException(
        `Refund ${refundId} (${formatMoney(amount)}) is at or above the approval threshold and has not been approved. Approve it via POST /refunds/${refundId}/approve first (maker/checker: never the raiser).`,
      );
    }

    const paidAt = new Date();
    const result = await this.endorsements.recordRefundDisbursement({
      refundId,
      customerId: endorsement.policy.customerId,
      amount,
      paidAt,
      ledgerReference: `refund:${refundId}`,
    });
    if (!result) {
      // 0 rows — a concurrent disbursement stamped paidAt first. Deterministic
      // 409, matching the "already disbursed" branch above.
      throw new ConflictException(
        `Refund ${refundId} was disbursed concurrently by another request.`,
      );
    }

    // Money as fixed 3dp strings, the maker/checker ids, and the ledger
    // pointer — never `reason` free text (endorsement.config.ts's
    // refundAuditSnapshot convention).
    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'Refund',
      entityId: refundId,
      afterValue: {
        refundId,
        endorsementId: refund.endorsementId,
        policyId: endorsement.policyId,
        customerId: endorsement.policy.customerId,
        amount: formatMoney(amount),
        raisedByUserId: refund.raisedByUserId,
        approvedByUserId: refund.approvedByUserId,
        approvalThresholdMatrixLevel: refund.approvalThresholdMatrixLevel,
        paidAt: paidAt.toISOString(),
        clientFundsLedgerEntryId: result.ledgerEntry.id,
      },
    });
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'ClientFundsLedgerEntry',
      entityId: result.ledgerEntry.id,
      afterValue: {
        entryId: result.ledgerEntry.id,
        customerId: result.ledgerEntry.customerId,
        amount: formatMoney(result.ledgerEntry.amount),
        direction: result.ledgerEntry.direction,
        reference: result.ledgerEntry.reference,
      },
    });

    return {
      id: refundId,
      endorsementId: refund.endorsementId,
      amount: formatMoney(amount),
      paidAt: paidAt.toISOString(),
      clientFundsLedgerEntryId: result.ledgerEntry.id,
    };
  }

  /** Audit failures never fail the request — the write has already committed
   * (same pattern as `PolicyService.safeAudit` / `InvoiceService.safeAudit`). */
  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Refund audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed: ${(err as Error).message}`,
      );
    }
  }
}
