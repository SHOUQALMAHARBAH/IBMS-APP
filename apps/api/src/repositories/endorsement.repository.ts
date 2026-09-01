import { Injectable } from '@nestjs/common';
import type {
  Cancellation,
  Endorsement,
  EndorsementType,
  Prisma,
  Refund,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

const ENDORSEMENT_INCLUDE = {
  cancellation: true,
  refund: true,
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
        status: { not: 'CLIENT_NOTIFIED' },
      },
    });
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
  ): Promise<Refund | null> {
    const { count } = await this.prisma.client.refund.updateMany({
      where: { id, approvedByUserId: null },
      data: {
        approvedByUserId,
        approvalThresholdMatrixLevel: 'approved_above_threshold',
      },
    });
    if (count === 0) return null;
    return this.prisma.client.refund.findUniqueOrThrow({ where: { id } });
  }
}
