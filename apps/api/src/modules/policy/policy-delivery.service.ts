import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { DeliveryRecord, PolicyStatus } from '@ibms/db';
import { PolicyRepository } from '../../repositories/policy.repository';
import { PolicyDeliveryRepository } from '../../repositories/policy-delivery.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import {
  deliveryAuditSnapshot,
  receiptAckAuditSnapshot,
} from './policy-delivery.config';
import { PolicyService, type PolicyView } from './policy.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { RecordPolicyDeliveryDto } from './dto/record-policy-delivery.dto';
import type { AcknowledgeReceiptDto } from './dto/acknowledge-receipt.dto';

/**
 * Process 21 — Policy Delivery (backlog Part C #21, Domain B).
 *
 *  - `recordDelivery` — record that the issued policy document reached the
 *    client (`method` / `recipient` / `deliveredAt`). One `DeliveryRecord`
 *    per `Policy` (`policyId @unique`). Moves the `Policy` `VERIFIED →
 *    DELIVERED` through `WorkflowTransitionService.transition` (its
 *    status-conditional `updateMany` is the race gate — a concurrent delivery
 *    matches 0 rows → 409); the `DeliveryRecord` is then created. A
 *    crash-recovery re-entry branch (status already `DELIVERED`, no
 *    `DeliveryRecord` yet) creates the missing record without re-transitioning.
 *  - `acknowledgeReceipt` — record the client's confirmation that they
 *    received it (`DeliveryRecord.receiptAcknowledgedAt`, a status-conditional
 *    stamp → 409 on a double-ack) and **best-effort** advance the `Policy`
 *    `DELIVERED → ACTIVE` (logged, never thrown — the `receiptAcknowledgedAt`
 *    stamp is the authoritative "client confirmed" record).
 *
 * `DeliveryRecord` is NOT a `WorkflowTransitionService` entity (no `status` —
 * its lifecycle is the parent `Policy`'s status). Visibility mirrors the rest
 * of the module — a policy inherits its Customer's visibility (`PolicyService.
 * loadVisible`, which trusts `POLICY_CROSS_OWNER_ROLES` + the Customer owner).
 */
@Injectable()
export class PolicyDeliveryService {
  private readonly logger = new Logger(PolicyDeliveryService.name);

  constructor(
    private readonly deliveries: PolicyDeliveryRepository,
    private readonly policies: PolicyRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
    private readonly policyService: PolicyService,
  ) {}

  /** Logged, not thrown — the real write already committed. */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `PolicyDelivery audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** Best-effort `Policy` advance — logged, never thrown. Not authoritative:
   * derive "delivered" from the `DeliveryRecord` table, "receipt confirmed"
   * from `DeliveryRecord.receiptAcknowledgedAt`. */
  private async advance(
    policyId: string,
    from: PolicyStatus,
    to: PolicyStatus,
    actorUserId: string,
  ): Promise<void> {
    const policy = await this.policies.findStatus(policyId);
    if (!policy || policy.status !== from) return;
    try {
      await this.workflow.transition({
        entityType: 'Policy',
        entityId: policyId,
        toStatus: to,
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `Policy ${policyId}: ${from} → ${to} advance did not apply: ${(err as Error).message}`,
      );
    }
  }

  async recordDelivery(
    policyId: string,
    dto: RecordPolicyDeliveryDto,
    actor: AuthenticatedUser,
  ): Promise<PolicyView> {
    const policy = await this.policyService.loadVisible(policyId, actor);

    const deliveredAt = dto.deliveredAt
      ? parseHistoricalInstant(dto.deliveredAt, 'deliveredAt')
      : new Date();

    const hasRecord = policy.deliveryRecord !== null;

    if (policy.status === 'VERIFIED') {
      // Normal path: the status flip is the race gate. The engine rejects a
      // concurrent delivery two ways depending on the interleaving — a
      // ConflictException (its status-conditional updateMany matched 0 rows)
      // or an UnprocessableEntityException (its own pre-read already saw
      // DELIVERED, "already in status"). The pre-check above already ruled
      // out the non-racing bad-state case, so BOTH here mean "the status
      // changed under us" → one 409, not a 409/422 coin toss.
      try {
        await this.workflow.transition({
          entityType: 'Policy',
          entityId: policyId,
          toStatus: 'DELIVERED',
          actorUserId: actor.id,
        });
      } catch (err) {
        if (
          err instanceof ConflictException ||
          err instanceof UnprocessableEntityException
        ) {
          throw new ConflictException(
            `Policy ${policyId}'s status changed concurrently — retry the delivery.`,
          );
        }
        throw err;
      }
    } else if (policy.status === 'DELIVERED' && !hasRecord) {
      // Crash-recovery re-entry: a prior call flipped the status (and
      // TRANSITION-audited it) but the DeliveryRecord insert then failed.
      // Just create the missing record.
      this.logger.warn(
        `Policy ${policyId}: resuming a partially-completed delivery (status already DELIVERED, no DeliveryRecord).`,
      );
    } else {
      throw new UnprocessableEntityException(
        `Policy ${policyId} is ${policy.status}; delivery is recorded once, from VERIFIED (after it passes checking).`,
      );
    }

    let record: DeliveryRecord;
    try {
      record = await this.deliveries.create({
        policyId,
        method: dto.method,
        recipient: dto.recipient,
        deliveredAt,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Policy ${policyId} already has a delivery record.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'DeliveryRecord',
      entityId: record.id,
      afterValue: deliveryAuditSnapshot(record),
    });

    return this.policyService.get(policyId, actor);
  }

  async acknowledgeReceipt(
    policyId: string,
    dto: AcknowledgeReceiptDto,
    actor: AuthenticatedUser,
  ): Promise<PolicyView> {
    const policy = await this.policyService.loadVisible(policyId, actor);

    const record = policy.deliveryRecord;
    if (!record) {
      throw new UnprocessableEntityException(
        `Policy ${policyId} has no delivery on record — nothing to acknowledge.`,
      );
    }

    if (record.receiptAcknowledgedAt !== null) {
      if (policy.status === 'DELIVERED') {
        // The stamp committed on a prior call but the DELIVERED → ACTIVE
        // advance did not — resume it, don't 409.
        await this.advance(policyId, 'DELIVERED', 'ACTIVE', actor.id);
        return this.policyService.get(policyId, actor);
      }
      throw new ConflictException(
        `Policy ${policyId}'s delivery receipt was already acknowledged.`,
      );
    }

    const acknowledgedAt = dto.acknowledgedAt
      ? parseHistoricalInstant(dto.acknowledgedAt, 'acknowledgedAt')
      : new Date();
    if (acknowledgedAt.getTime() < record.deliveredAt.getTime()) {
      throw new UnprocessableEntityException(
        'acknowledgedAt cannot be before the delivery date.',
      );
    }

    const stamped = await this.deliveries.stampReceiptAck(
      record.id,
      acknowledgedAt,
    );
    if (stamped === null) {
      throw new ConflictException(
        `Policy ${policyId}'s delivery receipt was acknowledged concurrently.`,
      );
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'DeliveryRecord',
      entityId: record.id,
      afterValue: receiptAckAuditSnapshot({
        policyId,
        deliveryRecordId: record.id,
        receiptAcknowledgedAt: acknowledgedAt,
      }),
    });

    await this.advance(policyId, 'DELIVERED', 'ACTIVE', actor.id);

    return this.policyService.get(policyId, actor);
  }
}
