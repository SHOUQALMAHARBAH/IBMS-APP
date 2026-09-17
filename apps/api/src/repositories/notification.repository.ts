import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The counts behind the notification bell.
 *
 * COUNTS, never rows, and that is the whole design. Reading a screening match
 * or a claim is an `isSensitiveDataAccess` audit event in this codebase —
 * `screening.controller.ts` already keeps a separate `matches/pending-count`
 * endpoint for exactly this reason, "without pulling Highly Confidential rows
 * (and so without an `isSensitiveDataAccess` read)". A bell that rendered on
 * every page load would otherwise write a sensitive-read row per navigation,
 * per user, and put customer names and claim narratives into a payload whose
 * only job is to say how many things need attention.
 *
 * So every method here returns a number. The notification centre says "3
 * claims are awaiting an insurer response" and links to the screen that
 * already enforces its own permissions and writes its own audit row when the
 * reader actually opens it.
 */
@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** SLA timers past their deadline and not yet resolved — breached or
   *  escalated. `escalatedTo` is free text (a role name or a function that
   *  has no RBAC role at all), so the caller decides who may see these. */
  countOverdueSlaTimers(now: Date, escalatedTo?: string[]): Promise<number> {
    return this.prisma.client.slaTimer.count({
      where: {
        resolvedAt: null,
        pausedAt: null,
        dueAt: { lt: now },
        ...(escalatedTo && escalatedTo.length > 0
          ? { escalatedTo: { in: escalatedTo } }
          : {}),
      },
    });
  }

  /** Claims where the insurer has not responded past the per-line threshold
   *  (Process 27). An open alert is one that has not been resolved. */
  countOpenClaimFollowUps(): Promise<number> {
    return this.prisma.client.claimFollowUpAlert.count({
      where: { resolvedAt: null },
    });
  }

  /** AML pattern hits still open (Process 48). */
  countOpenTransactionMonitoringAlerts(): Promise<number> {
    return this.prisma.client.transactionMonitoringAlert.count({
      where: { status: 'open' },
    });
  }

  /** Sanctions/PEP matches still awaiting a reviewer's decision. */
  countPendingScreeningMatches(): Promise<number> {
    return this.prisma.client.screeningMatch.count({
      where: { status: 'pending' },
    });
  }

  /** Service requests assigned to THIS user and not yet finished. */
  countOpenServiceRequestsAssignedTo(userId: string): Promise<number> {
    return this.prisma.client.serviceRequest.count({
      where: {
        assignedToUserId: userId,
        status: { notIn: ['fulfilled', 'cancelled'] },
      },
    });
  }

  /** Customers this user owns whose KYC has not been approved — the
   *  onboarding work sitting on their own desk. */
  countOwnedCustomersPendingKyc(userId: string): Promise<number> {
    return this.prisma.client.customer.count({
      where: { ownerUserId: userId, status: 'PENDING_KYC' },
    });
  }
}
