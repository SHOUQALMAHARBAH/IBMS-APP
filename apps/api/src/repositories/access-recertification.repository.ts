import { Injectable } from '@nestjs/common';
import type { AccessRecertificationCycle, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The two combined-duty relations, on every item a review screen reads.
 *
 * `AccessRecertificationItem` is the only row of the fifteen where the pair has TWO relations, and they
 * are NOT two pairs. The distinction is recorded on the schema and matters here:
 *
 *   `combinedDutyAct`         — the act on the ARRANGEMENT. She was SET TO review her own access, which
 *                               happens at INSERT when the cycle opens, and is what the CHECK constraint
 *                               accepts. In a one-person office this is the only way a cycle can start.
 *   `decisionCombinedDutyAct` — the act on the REVIEW. She DID review it, dated to the review. This one is
 *                               EVIDENCE rather than an escape column; its FK is what makes it evidence.
 *
 * So the record shows both, labelled differently, because "the cycle put her in this position" and "she
 * then confirmed her own access" are different facts and a reader is entitled to both. Collapsing them
 * would report a cycle that merely COULD NOT do better as if somebody had signed off on themselves.
 */
const ITEM_INCLUDE = {
  cycle: { select: { cycleLabel: true } },
  combinedDutyAct: true,
  decisionCombinedDutyAct: true,
} as const;

export type AccessRecertificationItemWithCycle =
  Prisma.AccessRecertificationItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

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
  ): Promise<Prisma.AccessRecertificationItemGetPayload<object>[]> {
    // No `include`: `createManyAndReturn` cannot take one, and these rows are internal to `startCycle`
    // rather than a wire shape — the acts are read back through `findItemsForReviewer`.
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

  findItemById(id: string): Promise<AccessRecertificationItemWithCycle | null> {
    return this.prisma.client.accessRecertificationItem.findUnique({
      where: { id },
      include: ITEM_INCLUDE,
    });
  }

  findItemsByReviewer(
    reviewerUserId: string,
    cycleId?: string,
  ): Promise<AccessRecertificationItemWithCycle[]> {
    return this.prisma.client.accessRecertificationItem.findMany({
      where: { reviewerUserId, ...(cycleId ? { cycleId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: ITEM_INCLUDE,
    });
  }

  /**
   * Every item in one cycle.
   *
   * Carries the cycle relation and a TOTAL order, both for the same reason its sibling above
   * does: a caller that renders these as a list needs the label without a second query, and a
   * `findMany` with no `orderBy` returns whatever order the plan produced — which for a screen
   * means rows that move between renders, and is the § 1.42 class this repository was already
   * bitten by when `findActiveUserIdsWithPermission` had no order and `pickReviewer` took `[0]`.
   * `createdAt` alone is not total: a cycle writes all of its items in one transaction, so
   * timestamps tie routinely.
   */
  findItemsByCycle(
    cycleId: string,
  ): Promise<AccessRecertificationItemWithCycle[]> {
    return this.prisma.client.accessRecertificationItem.findMany({
      where: { cycleId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: ITEM_INCLUDE,
    });
  }

  /**
   * The office's recertification cycles, newest first.
   *
   * Exists because `GET /cycles/:id/admin-items` needs a cycle id and nothing could supply one:
   * the only other source was the `POST /cycles` response, so the administrator review record
   * was readable for a cycle you had just started in this session and for no earlier one — and
   * "were the administrators reviewed in last quarter's cycle" is precisely the audit-time
   * question that route exists to answer. § 1.65's rule applied to a read: a route is only as
   * reachable as the thing it needs to be addressed by.
   */
  findCycles(): Promise<AccessRecertificationCycle[]> {
    return this.prisma.client.accessRecertificationCycle.findMany({
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
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
  ): Promise<AccessRecertificationItemWithCycle | null> {
    const { count } =
      await this.prisma.client.accessRecertificationItem.updateMany({
        where: { id, reviewerUserId, decision: null },
        data: { decision, reviewedAt: new Date(), decisionCombinedDutyActId },
      });
    if (count === 0) return null;
    return this.prisma.client.accessRecertificationItem.findUniqueOrThrow({
      where: { id },
      include: ITEM_INCLUDE,
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
