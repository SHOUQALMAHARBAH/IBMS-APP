import { Injectable } from '@nestjs/common';
import type { DeliveryRecord } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateDeliveryRecordInput {
  policyId: string;
  method: string;
  recipient: string;
  deliveredAt: Date;
}

/**
 * Process 21 — Policy Delivery (backlog Part C #21, Domain B). Owns the one
 * `DeliveryRecord` per `Policy` (`policyId @unique`).
 *
 * `DeliveryRecord` has no workflow `status` — its lifecycle is the parent
 * `Policy`'s status (`VERIFIED → DELIVERED → ACTIVE`), driven from
 * `PolicyDeliveryService` through `WorkflowTransitionService`. The
 * `policyId @unique` constraint is what makes "one delivery per policy" a
 * real invariant (ibms-brain/meta/lex/race-safe-invariants.md); the receipt
 * acknowledgement is a status-conditional `updateMany` so a double-ack loses
 * the race cleanly.
 */
@Injectable()
export class PolicyDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateDeliveryRecordInput): Promise<DeliveryRecord> {
    return this.prisma.client.deliveryRecord.create({ data: input });
  }

  /** Stamp `receiptAcknowledgedAt`, conditional on it not already being set.
   * Returns the updated row, or `null` when 0 rows matched (a concurrent
   * acknowledgement won). */
  async stampReceiptAck(
    id: string,
    acknowledgedAt: Date,
  ): Promise<DeliveryRecord | null> {
    const { count } = await this.prisma.client.deliveryRecord.updateMany({
      where: { id, receiptAcknowledgedAt: null },
      data: { receiptAcknowledgedAt: acknowledgedAt },
    });
    if (count === 0) return null;
    return this.prisma.client.deliveryRecord.findUniqueOrThrow({
      where: { id },
    });
  }
}
