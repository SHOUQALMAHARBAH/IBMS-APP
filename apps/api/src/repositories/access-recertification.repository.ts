import { Injectable } from '@nestjs/common';
import type {
  AccessRecertificationCycle,
  AccessRecertificationItem,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export type AccessRecertificationItemWithCycle = AccessRecertificationItem & {
  cycle: { cycleLabel: string };
};

@Injectable()
export class AccessRecertificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  createCycle(
    cycleLabel: string,
    dueAt: Date,
  ): Promise<AccessRecertificationCycle> {
    return this.prisma.client.accessRecertificationCycle.create({
      data: { cycleLabel, dueAt },
    });
  }

  /** Distinct users currently holding at least one non-revoked role. */
  async findActiveSubjectUserIds(): Promise<string[]> {
    const assignments = await this.prisma.client.userRoleAssignment.findMany({
      where: { revokedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });
    return assignments.map((a) => a.userId);
  }

  async getActiveRoleNamesForUser(userId: string): Promise<string[]> {
    const assignments = await this.prisma.client.userRoleAssignment.findMany({
      where: { userId, revokedAt: null },
      include: { role: true },
    });
    return assignments.map((a) => a.role.name);
  }

  /** One `INSERT ... RETURNING` for every (subject, reviewer) pair in the
   * cycle — `startCycle` builds the full list first, so this replaces N
   * sequential `create()` round-trips (which, over the whole active-user
   * set, was the slow path that made the access-recertification e2e flaky
   * under load). Returned rows are in `pairs` order. */
  createManyItems(
    cycleId: string,
    /** `combinedDutyActId` is set only for a declared self-review — see the service. It is what the
     *  `AccessRecertificationItem_maker_checker_distinct` CHECK accepts on INSERT, so a pair where the
     *  reviewer IS the subject and this is null is refused by the database, not by us. */
    pairs: {
      /** Supplied only for a declared self-review, because the act that excuses it must name the item and
       *  must exist first — see the service. Every other item lets the database generate its own. */
      id?: string;
      subjectUserId: string;
      reviewerUserId: string;
      combinedDutyActId?: string | null;
    }[],
  ): Promise<AccessRecertificationItem[]> {
    return this.prisma.client.accessRecertificationItem.createManyAndReturn({
      data: pairs.map((pair) => ({ cycleId, ...pair })),
    });
  }

  /**
   * Of these act ids, which are the act on the ARRANGEMENT — she was SET TO review her own access — as
   * opposed to the review itself.
   *
   * ASKED IN THIS DIRECTION ON PURPOSE, and the first version asked the other way.
   *
   * Both acts carry the same constraint name, so only the item knows which column each sits in. Looking up
   * the REVIEW acts and flagging those made the flag depend on a join SUCCEEDING: an act whose item had
   * gone, or one recorded by any path that does not write `decisionCombinedDutyActId`, would silently stop
   * sorting to the top of the self-approval report — and being at the top, always, is the owner's whole
   * condition. The report's own e2e caught it immediately.
   *
   * So the question is inverted. An access act is flagged unless it is POSITIVELY identified as the
   * arrangement, which means an act we cannot classify stays flagged. That is the safe direction: the cost
   * of a wrongly flagged act is one extra line at the top of a short report, and the cost of a wrongly
   * unflagged one is a self-review nobody sees.
   */
  async findArrangementActIds(actIds: string[]): Promise<string[]> {
    if (actIds.length === 0) return [];
    const rows = await this.prisma.client.accessRecertificationItem.findMany({
      where: { combinedDutyActId: { in: actIds } },
      select: { combinedDutyActId: true },
    });
    return rows
      .map((r) => r.combinedDutyActId)
      .filter((id): id is string => id !== null);
  }

  findItemById(id: string): Promise<AccessRecertificationItem | null> {
    return this.prisma.client.accessRecertificationItem.findUnique({
      where: { id },
    });
  }

  findItemsByReviewer(
    reviewerUserId: string,
    cycleId?: string,
  ): Promise<AccessRecertificationItemWithCycle[]> {
    return this.prisma.client.accessRecertificationItem.findMany({
      where: { reviewerUserId, ...(cycleId ? { cycleId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { cycle: { select: { cycleLabel: true } } },
    });
  }

  findItemsByCycle(cycleId: string): Promise<AccessRecertificationItem[]> {
    return this.prisma.client.accessRecertificationItem.findMany({
      where: { cycleId },
    });
  }

  /** Status-conditional: only writes if the item hasn't been decided yet
   * AND is still assigned to this reviewer — re-asserts both fields
   * `decide()` validated between its read and this write
   * (race-safe-invariants.md). `null` when 0 rows matched (a concurrent
   * decision won the race). */
  async recordDecision(
    id: string,
    reviewerUserId: string,
    decision: 'confirmed' | 'revoked' | 'changed',
    /** The act on the REVIEW, where the item's own `combinedDutyActId` is the act on the arrangement.
     *  Null on every ordinary two-person review. */
    decisionCombinedDutyActId: string | null = null,
  ): Promise<AccessRecertificationItem | null> {
    const { count } =
      await this.prisma.client.accessRecertificationItem.updateMany({
        where: { id, reviewerUserId, decision: null },
        data: { decision, reviewedAt: new Date(), decisionCombinedDutyActId },
      });
    if (count === 0) return null;
    return this.prisma.client.accessRecertificationItem.findUniqueOrThrow({
      where: { id },
    });
  }

  /** Revokes every currently-active role assignment for a user (the
   * recertification item covers the user's whole access, not one grant —
   * AccessRecertificationItem has no per-assignment foreign key). */
  /** Returns the number of rows actually revoked (Part V multi-tenancy item
   * 6). A legitimate zero exists — a user may hold no active grants — so the count is
   * reported rather than asserted; what it buys is that a caller or test can
   * check the post-condition instead of trusting a `void` return, which is
   * how an RLS-zero-filtered revoke passed for success in Phase 2 step 8. */
  async revokeAllActiveRoleAssignmentsForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.client.userRoleAssignment.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }
}
