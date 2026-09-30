import { Injectable } from '@nestjs/common';
import type { DsrStatus, DsrType, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/** The one terminal state; everything else is still the DPO's problem. */
const CLOSED_DSR_STATUS = 'CLOSED' as DsrStatus;

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
/**
 * The combined-duty act, on every DSR read.
 *
 * `DataSubjectRequest_maker_checker_distinct` requires that whoever logs a request is not whoever
 * closes it. When an office declares COMBINED mode one person may do both by stating why, and the
 * act lands in `combinedDutyActId`. Reading it back is what lets the REQUEST say so — Part 4 step 5,
 * "on the record, not only in a report".
 *
 * THE RELATION IS `closureCombinedDutyAct`, NOT `combinedDutyAct`. Each pair's escape column is named
 * after the CONSTRAINT it excuses rather than after the table, deliberately: `NeedsAssessment` has two
 * pairs and one shared column would let a declared combined REVIEW excuse a self-APPROVAL. So the name
 * must be read off the schema per pair — `grep 'CombinedDutyAct?' schema.prisma` lists all sixteen —
 * and assuming the uniform name is a compile error at best.
 *
 * On EVERY read and not only the detail one: the DPO's queue is where a statutory deadline is worked,
 * and a row there that was closed by its own logger should not have to be opened to find that out.
 */
const DSR_INCLUDE = { closureCombinedDutyAct: true } as const;

export type DataSubjectRequestWithAct = Prisma.DataSubjectRequestGetPayload<{
  include: typeof DSR_INCLUDE;
}>;

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
  }): Promise<DataSubjectRequestWithAct> {
    return this.prisma.client.dataSubjectRequest.create({
      data: {
        customerId: input.customerId,
        insuredPersonId: input.insuredPersonId,
        type: input.type,
        slaDueAt: input.slaDueAt,
        dpoHandlerUserId: input.dpoHandlerUserId,
        // status defaults to RECEIVED, receivedAt defaults to now()
      },
      // The include is here too, so `create` returns the same shape every read does. A newly logged
      // request cannot have a combined-duty act — nothing has closed it — so this always yields
      // `null`; what it buys is that the row type needs no optional field, and an optional field is
      // what lets the next caller pass a row whose act state nobody knows.
      include: DSR_INCLUDE,
    });
  }

  findById(id: string): Promise<DataSubjectRequestWithAct | null> {
    return this.prisma.client.dataSubjectRequest.findUnique({
      where: { id },
      include: DSR_INCLUDE,
    });
  }

  /**
   * The DPO's open-request queue (Part D §5.1 item #9).
   *
   * Filtered in SQL and ordered OLDEST FIRST, both load-bearing. The previous
   * shape — take the N most recent, then drop the closed ones in memory — has
   * two failure modes that get worse as the table grows: an open request older
   * than the window never reaches the queue at all, and the request that falls
   * out first is the oldest, which for a statutory-deadline queue is precisely
   * the one closest to breaching. Filtering first means the cap applies to
   * OPEN requests only; ordering ascending means that if the cap is ever hit,
   * what it truncates is the least urgent tail, never the most urgent head.
   */
  findOpenQueue(take: number): Promise<DataSubjectRequestWithAct[]> {
    return this.prisma.client.dataSubjectRequest.findMany({
      where: { status: { not: CLOSED_DSR_STATUS } },
      orderBy: { createdAt: 'asc' },
      take,
      include: DSR_INCLUDE,
    });
  }

  findMany(
    scope: DsrScope,
    take: number,
  ): Promise<DataSubjectRequestWithAct[]> {
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
      include: DSR_INCLUDE,
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
