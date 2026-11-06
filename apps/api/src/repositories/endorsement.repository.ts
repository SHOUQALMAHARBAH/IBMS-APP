import { Injectable } from '@nestjs/common';
import type {
  Cancellation,
  ClientFundsLedgerEntry,
  Endorsement,
  EndorsementType,
  Prisma,
  Refund,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { quantizeMoney } from '../common/money.util';

const ENDORSEMENT_INCLUDE = {
  cancellation: true,
  // Part 4 step 5 — the declared combined-duty act, so a reader looking at the refund sees on the record
  // itself that nobody else signed it. Null on every ordinary approval, which is every one today.
  refund: { include: { combinedDutyAct: true } },
  commissionReversal: true,
  schedule: true,
  policy: {
    select: {
      id: true,
      customerId: true,
      status: true,
      // The parent Opportunity — used to read the placed quotation's
      // commission rate for the auto-tied CommissionReversal.
      opportunityId: true,
    },
  },
} as const;

export type EndorsementWithContext = Prisma.EndorsementGetPayload<{
  include: typeof ENDORSEMENT_INCLUDE;
}>;

export interface CreateEndorsementInput {
  policyId: string;
  type: EndorsementType;
  changeType: string;
  premiumAdjustment: Prisma.Decimal;
  effectiveFrom: Date;
  requestedByUserId: string;
  targetCoverage: Prisma.InputJsonValue | null;
}

export interface CreateCancellationInput {
  endorsementId: string;
  reason: string;
  basis: string;
  returnPremium: Prisma.Decimal;
}

export interface CreateRefundInput {
  endorsementId: string;
  amount: Prisma.Decimal;
  reason: string;
  raisedByUserId: string;
  approvalThresholdMatrixLevel: string;
}

/**
 * Process 22 — Endorsement Management (backlog Part C #22, Domain B). Owns
 * `Endorsement` and its one-per-endorsement children `Cancellation`,
 * `Refund`, `CommissionReversal` (all `endorsementId @unique`).
 *
 * `Endorsement` IS a `WorkflowTransitionService` entity — its `status`
 * (`EndorsementStatus`) moves ONLY through the engine; nothing here writes it.
 * The `Refund` maker/checker (`raisedByUserId` ≠ `approvedByUserId`) is
 * enforced in the service by `assertDifferentActors` and, at the DB layer, by
 * the pre-existing `Refund_maker_checker_distinct` CHECK (migration
 * `20260826091424`); `recordRefundApproval` is a status-conditional
 * `updateMany` so a double-approve loses the race cleanly (0 rows → 409).
 */
@Injectable()
export class EndorsementRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateEndorsementInput): Promise<Endorsement> {
    return this.prisma.client.endorsement.create({
      data: this.toColumns(input),
    });
  }

  private toColumns(
    input: CreateEndorsementInput,
  ): Prisma.EndorsementUncheckedCreateInput {
    return {
      policyId: input.policyId,
      type: input.type,
      changeType: input.changeType,
      premiumAdjustment: input.premiumAdjustment,
      effectiveFrom: input.effectiveFrom,
      requestedByUserId: input.requestedByUserId,
      targetCoverage: input.targetCoverage ?? undefined,
    };
  }

  /** Create the cancellation endorsement + its `Cancellation` child in ONE
   * transaction (a local exception, like `quotation.repository.ts`) — the
   * pair is meaningless apart, and a crash between them would strand an
   * endorsement that can never be applied. */
  createCancellationEndorsement(
    endorsement: CreateEndorsementInput,
    cancellation: Omit<CreateCancellationInput, 'endorsementId'>,
  ): Promise<{ endorsement: Endorsement; cancellation: Cancellation }> {
    return this.prisma.client.$transaction(async (tx) => {
      const e = await tx.endorsement.create({
        data: this.toColumns(endorsement),
      });
      const c = await tx.cancellation.create({
        data: { ...cancellation, endorsementId: e.id },
      });
      return { endorsement: e, cancellation: c };
    });
  }

  /** Create the `Refund` (maker side) + the auto-tied `CommissionReversal` in
   * ONE transaction, so "a return premium is recorded" ⟺ "a commission
   * reversal exists" (`policy-lifecycle.md`: "the two numbers must move
   * together"). Either `@unique` on `endorsementId` firing rolls both back →
   * the caller maps `P2002` to 409, and (because the pair is atomic)
   * `Refund` existing ⟺ `CommissionReversal` existing, so the caller's single
   * "has the refund been created?" check guards both. */
  createRefundAndReversal(
    refund: CreateRefundInput,
    reversal: { endorsementId: string; amount: Prisma.Decimal },
  ): Promise<void> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.refund.create({ data: refund });
      await tx.commissionReversal.create({ data: reversal });
    });
  }

  /** The one in-flight cancellation `Endorsement` for a policy, if any — a
   * cancellation that has not yet reached the terminal `CLIENT_NOTIFIED`. Used
   * for the friendly pre-check in `requestCancellation`; the partial UNIQUE
   * index `Endorsement_one_live_cancellation_per_policy` (migration
   * `20260902170000`) is the actual race backstop. */
  findLiveCancellation(policyId: string): Promise<Endorsement | null> {
    return this.prisma.client.endorsement.findFirst({
      where: {
        policyId,
        changeType: 'cancellation',
        // A DISCARDED CANCELLATION MUST FREE THE POLICY. Without this clause a cancellation raised in error
        // and withdrawn would block every future cancellation of that policy — permanently, since a
        // discarded record cannot advance to CLIENT_NOTIFIED. That is the trap this feature exists to
        // remove, reappearing one level down. The partial UNIQUE index behind this pre-check carries the
        // same predicate (migration `20261027120000`), because the index is the real backstop and a
        // friendlier application check in front of a refusing constraint helps nobody.
        discardedAt: null,
        status: { not: 'CLIENT_NOTIFIED' },
      },
    });
  }

  /**
   * The signed sum of every premium adjustment that has actually TAKEN EFFECT on a policy — added
   * 2026-11-06 (module 0-c batch 6) for the cancellation return premium.
   *
   * `Policy.issuedPremium` is written ONCE, at issuance, and never again — measured: the only write
   * in the codebase is `recordIssuance`, and nothing under `modules/endorsement` writes it at all.
   * An endorsement records its money as `premiumAdjustment` on its OWN row. So the premium in force
   * today is `issuedPremium + Σ(adjustments that were applied)`, and reading `issuedPremium` alone
   * gives the premium as at the day the policy was issued.
   *
   * `APPLIED` and `CLIENT_NOTIFIED` only, and that is the whole correctness of this read: an
   * endorsement sitting at `REQUESTED`, `SUBMITTED_TO_INSURER`, `INSURER_CONFIRMED`,
   * `FINANCIAL_ADJUSTMENT_CALCULATED` or `REFUND_APPROVAL_PENDING` has NOT changed the cover, so
   * counting it would refund against money the client was never charged. `CLIENT_NOTIFIED` is
   * included because it is `APPLIED`'s successor, not an alternative to it.
   *
   * `discardedAt: null`, for the reason `findLiveCancellation` above gives: a withdrawn endorsement
   * must not move a figure.
   *
   * `premiumAdjustment` is ALREADY SIGNED on the row — `signedPremiumAdjustment` stores a NEGATIVE
   * type as `subtractMoney(0, q)` — so this is a plain sum and must NOT be re-signed by the caller.
   *
   * Returns `Prisma.Decimal`, never a number: `_sum` on a `Decimal(18,3)` column comes back as a
   * `Decimal`, and a policy with no applied endorsements yields `null`, which becomes a quantized
   * zero rather than being coerced.
   */
  async sumAppliedPremiumAdjustments(
    policyId: string,
  ): Promise<Prisma.Decimal> {
    const { _sum } = await this.prisma.client.endorsement.aggregate({
      where: {
        policyId,
        discardedAt: null,
        status: { in: ['APPLIED', 'CLIENT_NOTIFIED'] },
      },
      _sum: { premiumAdjustment: true },
    });
    return quantizeMoney(_sum.premiumAdjustment ?? 0);
  }

  stampCancellationClientNotified(id: string): Promise<Cancellation> {
    return this.prisma.client.cancellation.update({
      where: { id },
      data: { clientNotifiedAt: new Date() },
    });
  }

  findById(id: string): Promise<EndorsementWithContext | null> {
    return this.prisma.client.endorsement.findUnique({
      where: { id },
      include: ENDORSEMENT_INCLUDE,
    });
  }

  findRefundById(
    id: string,
  ): Promise<(Refund & { endorsement: EndorsementWithContext }) | null> {
    return this.prisma.client.refund.findUnique({
      where: { id },
      include: { endorsement: { include: ENDORSEMENT_INCLUDE } },
    });
  }

  findManyByPolicyId(policyId: string): Promise<EndorsementWithContext[]> {
    return this.prisma.client.endorsement.findMany({
      where: { policyId },
      include: ENDORSEMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  updatePremiumAdjustment(
    id: string,
    premiumAdjustment: Prisma.Decimal,
  ): Promise<Endorsement> {
    return this.prisma.client.endorsement.update({
      where: { id },
      data: { premiumAdjustment },
    });
  }

  /** Stamp `Refund.approvedByUserId` + `approvalThresholdMatrixLevel`,
   * conditional on it not already being set. `null` when 0 rows matched (a
   * concurrent approval won). `approvalThresholdMatrixLevel` keeps the
   * "was above threshold" signal (`approved_above_threshold`). */
  async recordRefundApproval(
    id: string,
    approvedByUserId: string,
    /**
     * Part 4 — the declared combined-duty act, when the approver IS the raiser in an office that has declared
     * COMBINED mode. Null on every ordinary two-person approval, which is every approval until an office
     * declares the mode.
     *
     * The column is what `Refund_maker_checker_distinct` reads: with it null, a self-approval is refused by
     * the constraint no matter what the application decided.
     */
    combinedDutyActId: string | null = null,
  ): Promise<Refund | null> {
    const { count } = await this.prisma.client.refund.updateMany({
      where: { id, approvedByUserId: null },
      data: {
        approvedByUserId,
        approvalThresholdMatrixLevel: 'approved_above_threshold',
        ...(combinedDutyActId === null ? {} : { combinedDutyActId }),
      },
    });
    if (count === 0) return null;
    return this.prisma.client.refund.findUniqueOrThrow({ where: { id } });
  }

  /** Stamp `Refund.paidAt` AND book the matching `out`
   * `ClientFundsLedgerEntry` in ONE `$transaction`, so a disbursement can
   * never exist without its client-money movement (the same guarantee
   * `InvoiceRepository.recordReceiptWithLedger` gives the `in` side — Part
   * 7.3 client-money segregation).
   *
   * The stamp is a status-conditional `updateMany` on `paidAt: null`
   * (`race-safe-invariants.md`) — two concurrent disbursements cannot both
   * pay out, the loser matches 0 rows and the transaction is abandoned
   * before the ledger row is written. */
  async recordRefundDisbursement(input: {
    refundId: string;
    customerId: string;
    amount: Prisma.Decimal;
    /** Re-asserted in the `where` below. `null` when the amount is under the
     * approval threshold and no approval was required. */
    approvedByUserId: string | null;
    paidAt: Date;
    ledgerReference: string;
  }): Promise<{ refund: Refund; ledgerEntry: ClientFundsLedgerEntry } | null> {
    return this.prisma.client.$transaction(async (tx) => {
      // Re-assert EVERY field the caller validated, not just `paidAt`
      // (`race-safe-invariants.md` § Rule). `RefundService.disburse` checked
      // the amount and the approval before getting here; if either moved in
      // between, this must match 0 rows rather than pay out against a stale
      // read. Today `Refund.amount` is write-once and `approvedByUserId` only
      // ever goes null -> set, so no interleaving currently misbehaves — but
      // that is incidental, not enforced, and the day either becomes mutable
      // this would silently disburse a figure nobody approved.
      const { count } = await tx.refund.updateMany({
        where: {
          id: input.refundId,
          paidAt: null,
          amount: input.amount,
          approvedByUserId: input.approvedByUserId,
        },
        data: { paidAt: input.paidAt },
      });
      if (count === 0) return null;

      const ledgerEntry = await tx.clientFundsLedgerEntry.create({
        data: {
          customerId: input.customerId,
          amount: input.amount,
          direction: 'out',
          reference: input.ledgerReference,
        },
      });
      const refund = await tx.refund.findUniqueOrThrow({
        where: { id: input.refundId },
      });
      return { refund, ledgerEntry };
    });
  }
  /**
   * Mark this record discarded — raised in error, never took effect.
   *
   * `updateMany` re-asserting `discardedAt: null` in its own `where`, not `update`: two people discarding
   * the same record at once must not have the second silently overwrite the first one's reason. A count of
   * 0 means somebody else got there, and the service turns that into a 409 naming it
   * (`race-safe-invariants.md`).
   *
   * The three columns are written together because a CHECK constraint refuses them apart — a discard
   * carrying no reason is the one shape nobody can read later.
   */
  async discard(
    id: string,
    input: { discardedByUserId: string; discardedReason: string },
  ): Promise<{ discarded: boolean }> {
    const { count } = await this.prisma.client.endorsement.updateMany({
      where: { id, discardedAt: null },
      data: {
        discardedAt: new Date(),
        discardedByUserId: input.discardedByUserId,
        discardedReason: input.discardedReason.trim(),
      },
    });
    return { discarded: count > 0 };
  }
}
