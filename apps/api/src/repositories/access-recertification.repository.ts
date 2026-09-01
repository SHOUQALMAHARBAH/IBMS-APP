import { Injectable } from '@nestjs/common';
import type {
  AccessRecertificationCycle,
  AccessRecertificationItem,
  RoleName,
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

  async getActiveRoleNamesForUser(userId: string): Promise<RoleName[]> {
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
    pairs: { subjectUserId: string; reviewerUserId: string }[],
  ): Promise<AccessRecertificationItem[]> {
    return this.prisma.client.accessRecertificationItem.createManyAndReturn({
      data: pairs.map((pair) => ({ cycleId, ...pair })),
    });
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

  recordDecision(
    id: string,
    decision: 'confirmed' | 'revoked' | 'changed',
  ): Promise<AccessRecertificationItem> {
    return this.prisma.client.accessRecertificationItem.update({
      where: { id },
      data: { decision, reviewedAt: new Date() },
    });
  }

  /** Revokes every currently-active role assignment for a user (the
   * recertification item covers the user's whole access, not one grant —
   * AccessRecertificationItem has no per-assignment foreign key). */
  async revokeAllActiveRoleAssignmentsForUser(userId: string): Promise<void> {
    await this.prisma.client.userRoleAssignment.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
