import { Injectable } from '@nestjs/common';
import type { Prisma, ServiceRequest } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

const WITH_SLA = {
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
  },
} as const;

export type ServiceRequestWithSla = Prisma.ServiceRequestGetPayload<
  typeof WITH_SLA
>;

/**
 * Process 41 — Customer Requests (backlog Part C #41, Domain E). Owns the
 * `ServiceRequest` rows, wrapping `PrismaService` (services depend on
 * repositories in this codebase, never on Prisma directly).
 *
 * `status` moves are status-conditional `updateMany`s (never a bare
 * `.status =` — `ibms-brain/meta/lex/race-safe-invariants.md`); a 0-row result
 * means the request was already past the `from` state.
 */
@Injectable()
export class ServiceRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  customerExists(customerId: string): Promise<boolean> {
    return this.prisma.client.customer
      .count({ where: { id: customerId } })
      .then((n) => n > 0);
  }

  /** The policy's `customerId`, or null when the policy does not exist — the
   * service checks it matches the request's customer. */
  policyCustomerId(policyId: string): Promise<string | null> {
    return this.prisma.client.policy
      .findUnique({ where: { id: policyId }, select: { customerId: true } })
      .then((p) => p?.customerId ?? null);
  }

  userExists(userId: string): Promise<boolean> {
    return this.prisma.client.user
      .count({ where: { id: userId } })
      .then((n) => n > 0);
  }

  create(input: {
    customerId: string;
    policyId: string | null;
    requestType: string;
    detail: string | null;
    raisedByUserId: string;
    assignedToUserId: string | null;
  }): Promise<ServiceRequest> {
    return this.prisma.client.serviceRequest.create({
      data: {
        customerId: input.customerId,
        policyId: input.policyId,
        requestType: input.requestType,
        detail: input.detail,
        status: 'open',
        raisedByUserId: input.raisedByUserId,
        assignedToUserId: input.assignedToUserId,
      },
    });
  }

  /** Link the request to its (best-effort) SLA timer row after `startTimer`. */
  attachSlaTimer(id: string, slaTimerId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.client.serviceRequest.updateMany({
      where: { id, slaTimerId: null },
      data: { slaTimerId },
    });
  }

  findById(id: string): Promise<ServiceRequestWithSla | null> {
    return this.prisma.client.serviceRequest.findUnique({
      where: { id },
      ...WITH_SLA,
    });
  }

  findMany(
    scope: { customerId?: string; status?: string; assignedToUserId?: string },
    take: number,
  ): Promise<ServiceRequestWithSla[]> {
    return this.prisma.client.serviceRequest.findMany({
      where: {
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
        ...(scope.status ? { status: scope.status } : {}),
        ...(scope.assignedToUserId
          ? { assignedToUserId: scope.assignedToUserId }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...WITH_SLA,
    });
  }

  /** Set / change the assignee while the request is still open or in progress. */
  recordAssignment(
    id: string,
    assignedToUserId: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.serviceRequest.updateMany({
      where: { id, status: { in: ['open', 'in_progress'] } },
      data: { assignedToUserId },
    });
  }

  /** `open -> in_progress`. Status-conditional — 0 rows means it was already
   * past `open`. */
  recordStart(id: string): Promise<Prisma.BatchPayload> {
    return this.prisma.client.serviceRequest.updateMany({
      where: { id, status: 'open' },
      data: { status: 'in_progress' },
    });
  }

  /** `{open|in_progress} -> fulfilled | cancelled`, stamping `closedAt`, the
   * verbatim `outcomeNote`, and (fulfil only) `fulfilledByUserId`.
   * Status-conditional — 0 rows means it was already closed. */
  recordClosure(
    id: string,
    input: {
      toStatus: 'fulfilled' | 'cancelled';
      outcomeNote: string;
      fulfilledByUserId: string | null;
      closedAt: Date;
    },
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.serviceRequest.updateMany({
      where: { id, status: { in: ['open', 'in_progress'] } },
      data: {
        status: input.toStatus,
        outcomeNote: input.outcomeNote,
        fulfilledByUserId: input.fulfilledByUserId,
        closedAt: input.closedAt,
      },
    });
  }
}
