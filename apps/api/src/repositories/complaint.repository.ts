import { Injectable } from '@nestjs/common';
import type { ComplaintStatus, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

const WITH_DETAIL = {
  include: {
    slaTimer: {
      select: {
        id: true,
        dueAt: true,
        escalatedAt: true,
        escalatedTo: true,
        resolvedAt: true,
      },
    },
    actions: true,
    escalations: true,
  },
} as const;

export type ComplaintWithDetail = Prisma.ComplaintGetPayload<
  typeof WITH_DETAIL
>;

/**
 * Process 42 — Complaints Management (backlog Part C #42, Domain E). Owns the
 * `Complaint` / `ComplaintAction` / `EscalationRecord` rows.
 *
 * `Complaint.status` moves go through `WorkflowTransitionService` (the engine
 * from the `@Global()` `WorkflowModule`), not this repository — the only
 * status write here is `recordAssignee`, which sets `responsibleEmployeeUserId`
 * WITHOUT a status change (status-conditional so a concurrent transition wins
 * the race — `ibms-brain/meta/lex/race-safe-invariants.md`).
 */
@Injectable()
export class ComplaintRepository {
  constructor(private readonly prisma: PrismaService) {}

  customerExists(customerId: string): Promise<boolean> {
    return this.prisma.client.customer
      .count({ where: { id: customerId } })
      .then((n) => n > 0);
  }

  userExists(userId: string): Promise<boolean> {
    return this.prisma.client.user
      .count({ where: { id: userId } })
      .then((n) => n > 0);
  }

  /** The claim's `customerId`, or null when the claim does not exist — the
   * service checks it matches the complaint's customer ("link it to a claim on
   * dispute"). */
  claimCustomerId(claimId: string): Promise<string | null> {
    return this.prisma.client.claim
      .findUnique({ where: { id: claimId }, select: { customerId: true } })
      .then((c) => c?.customerId ?? null);
  }

  /** The policy's `customerId`, or null when the policy does not exist. */
  policyCustomerId(policyId: string): Promise<string | null> {
    return this.prisma.client.policy
      .findUnique({ where: { id: policyId }, select: { customerId: true } })
      .then((p) => p?.customerId ?? null);
  }

  create(input: {
    customerId: string;
    claimId: string | null;
    policyId: string | null;
    issue: string;
    category: string | null;
    responsibleEmployeeUserId: string | null;
  }): Promise<{ id: string }> {
    return this.prisma.client.complaint.create({
      data: {
        customerId: input.customerId,
        claimId: input.claimId,
        policyId: input.policyId,
        issue: input.issue,
        category: input.category,
        responsibleEmployeeUserId: input.responsibleEmployeeUserId,
        // status defaults to LOGGED
      },
      select: { id: true },
    });
  }

  /** Link the complaint to its (best-effort) SLA timer row after `startTimer`. */
  attachSlaTimer(id: string, slaTimerId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.client.complaint.updateMany({
      where: { id, slaTimerId: null },
      data: { slaTimerId },
    });
  }

  findById(id: string): Promise<ComplaintWithDetail | null> {
    return this.prisma.client.complaint.findUnique({
      where: { id },
      ...WITH_DETAIL,
    });
  }

  findMany(
    scope: {
      customerId?: string;
      status?: string;
      claimId?: string;
      responsibleEmployeeUserId?: string;
    },
    take: number,
  ): Promise<ComplaintWithDetail[]> {
    return this.prisma.client.complaint.findMany({
      where: {
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
        ...(scope.status ? { status: scope.status as ComplaintStatus } : {}),
        ...(scope.claimId ? { claimId: scope.claimId } : {}),
        ...(scope.responsibleEmployeeUserId
          ? { responsibleEmployeeUserId: scope.responsibleEmployeeUserId }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...WITH_DETAIL,
    });
  }

  /** Set / change the handler WITHOUT a status change, while the complaint is
   * being worked (`ASSIGNED` | `IN_PROGRESS` | `ESCALATED`). Status-conditional
   * — 0 rows means it moved to `LOGGED` (impossible), `RESOLVED`, or `CLOSED`. */
  recordAssignee(
    id: string,
    responsibleEmployeeUserId: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.complaint.updateMany({
      where: {
        id,
        status: { in: ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED'] },
      },
      data: { responsibleEmployeeUserId },
    });
  }

  createAction(input: {
    complaintId: string;
    actionText: string;
    takenByUserId: string;
  }): Promise<{ id: string }> {
    return this.prisma.client.complaintAction.create({
      data: {
        complaintId: input.complaintId,
        actionText: input.actionText,
        takenByUserId: input.takenByUserId,
      },
      select: { id: true },
    });
  }

  createEscalation(input: {
    complaintId: string;
    escalatedTo: string;
    escalatedByUserId: string;
    reason: string | null;
  }): Promise<{ id: string }> {
    return this.prisma.client.escalationRecord.create({
      data: {
        complaintId: input.complaintId,
        escalatedTo: input.escalatedTo,
        escalatedByUserId: input.escalatedByUserId,
        reason: input.reason,
      },
      select: { id: true },
    });
  }
}
