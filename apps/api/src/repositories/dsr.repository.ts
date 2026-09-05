import { Injectable } from '@nestjs/common';
import type { DataSubjectRequest, DsrStatus, DsrType, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface DsrScope {
  customerId?: string;
  insuredPersonId?: string;
  status?: string;
  type?: string;
  dpoHandlerUserId?: string;
}

/**
 * M04 — Data Subject Request Management (backlog Part D, Process #52). Owns
 * `DataSubjectRequest` reads/writes.
 *
 * `DataSubjectRequest.status` moves go through `WorkflowTransitionService`
 * (the engine from the `@Global()` `WorkflowModule`), not this repository —
 * the only status-free write here is `recordHandlerAssignment`, the
 * `ComplaintRepository.recordAssignee` shape (status-conditional so a
 * concurrent transition wins the race — `race-safe-invariants.md`).
 */
@Injectable()
export class DsrRepository {
  constructor(private readonly prisma: PrismaService) {}

  customerExists(customerId: string): Promise<boolean> {
    return this.prisma.client.customer
      .count({ where: { id: customerId } })
      .then((n) => n > 0);
  }

  insuredPersonExists(insuredPersonId: string): Promise<boolean> {
    return this.prisma.client.insuredPerson
      .count({ where: { id: insuredPersonId } })
      .then((n) => n > 0);
  }

  userExists(userId: string): Promise<boolean> {
    return this.prisma.client.user
      .count({ where: { id: userId } })
      .then((n) => n > 0);
  }

  create(input: {
    customerId: string | null;
    insuredPersonId: string | null;
    type: DsrType;
    slaDueAt: Date;
    dpoHandlerUserId: string | null;
  }): Promise<DataSubjectRequest> {
    return this.prisma.client.dataSubjectRequest.create({
      data: {
        customerId: input.customerId,
        insuredPersonId: input.insuredPersonId,
        type: input.type,
        slaDueAt: input.slaDueAt,
        dpoHandlerUserId: input.dpoHandlerUserId,
        // status defaults to RECEIVED, receivedAt defaults to now()
      },
    });
  }

  findById(id: string): Promise<DataSubjectRequest | null> {
    return this.prisma.client.dataSubjectRequest.findUnique({
      where: { id },
    });
  }

  findMany(scope: DsrScope, take: number): Promise<DataSubjectRequest[]> {
    return this.prisma.client.dataSubjectRequest.findMany({
      where: {
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
        ...(scope.insuredPersonId
          ? { insuredPersonId: scope.insuredPersonId }
          : {}),
        ...(scope.status ? { status: scope.status as DsrStatus } : {}),
        ...(scope.type ? { type: scope.type as DsrType } : {}),
        ...(scope.dpoHandlerUserId
          ? { dpoHandlerUserId: scope.dpoHandlerUserId }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Set / change the DPO handler WITHOUT a status change — legal while the
   * request is still being worked (`RECEIVED` | `IDENTITY_VERIFIED` |
   * `IN_PROGRESS`). Status-conditional — 0 rows means it already moved to a
   * processed or closed state. */
  recordHandlerAssignment(
    id: string,
    dpoHandlerUserId: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.dataSubjectRequest.updateMany({
      where: {
        id,
        status: { in: ['RECEIVED', 'IDENTITY_VERIFIED', 'IN_PROGRESS'] },
      },
      data: { dpoHandlerUserId },
    });
  }

  /** The one allowed ACCESS extension — write-once (`accessExtensionAppliedAt
   * IS NULL` in the guard) AND status-conditional (the same
   * `recordHandlerAssignment` shape three lines above), so a DSR that
   * reached a processed/closed status between the service's read and this
   * write loses the race explicitly instead of silently re-basing the
   * deadline (and, via the service's SLA re-basing that follows, opening a
   * fresh pair of `SlaTimer` rows) on a request that already concluded. */
  applyExtension(
    id: string,
    newSlaDueAt: Date,
    reason: string,
    appliedAt: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.dataSubjectRequest.updateMany({
      where: {
        id,
        accessExtensionAppliedAt: null,
        status: { in: ['RECEIVED', 'IDENTITY_VERIFIED', 'IN_PROGRESS'] },
      },
      data: {
        slaDueAt: newSlaDueAt,
        accessExtensionAppliedAt: appliedAt,
        extensionReason: reason,
      },
    });
  }
}
