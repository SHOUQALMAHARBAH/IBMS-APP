import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface PolicyDashboardFilters {
  ownerUserIds?: string[];
  insuranceLine?: string;
  insurerId?: string;
}

/** Bounds the cancelled-policies list — a plain, capped `findMany` (free-text
 * `reason` can't be `groupBy`'d meaningfully), the #62 Portfolio Analysis
 * "capped findMany" shape. */
export const CANCELLED_POLICIES_READ_LIMIT = 200;

/** Part E Policy Dashboard — reads Policy/Endorsement/Cancellation
 * directly (no cross-module service dependency). See
 * `policy-dashboard.config.ts`'s header comment for which filter/date
 * field applies to which metric. */
@Injectable()
export class PolicyDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserIdsInBranch(branchId: string): Promise<{ id: string }[]> {
    return this.prisma.client.user.findMany({
      where: { branchId },
      select: { id: true },
    });
  }

  private policyFilterWhere(
    filters: PolicyDashboardFilters,
  ): Prisma.PolicyWhereInput {
    return {
      ...(filters.ownerUserIds
        ? { placedByUserId: { in: filters.ownerUserIds } }
        : {}),
      ...(filters.insuranceLine
        ? { insuranceLine: filters.insuranceLine }
        : {}),
      ...(filters.insurerId ? { insurerId: filters.insurerId } : {}),
    };
  }

  /** Live snapshot as of `now` — never period-scoped. */
  countActive(filters: PolicyDashboardFilters): Promise<number> {
    return this.prisma.client.policy.count({
      where: { status: 'ACTIVE', ...this.policyFilterWhere(filters) },
    });
  }

  /** Live snapshot: ACTIVE policies whose expiryDate falls in
   * `[now, now + renewalWindowDays)`. */
  countExpiringWithinWindow(
    filters: PolicyDashboardFilters,
    now: Date,
    windowEnd: Date,
  ): Promise<number> {
    return this.prisma.client.policy.count({
      where: {
        status: 'ACTIVE',
        expiryDate: { gte: now, lt: windowEnd },
        ...this.policyFilterWhere(filters),
      },
    });
  }

  /** Period-scoped: `issuedPremium IS NOT NULL` (the KPI Dashboard "issued"
   * test) and `createdAt` in the period. */
  countNewlyIssued(
    filters: PolicyDashboardFilters,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.client.policy.count({
      where: {
        issuedPremium: { not: null },
        createdAt: { gte: from, lt: to },
        ...this.policyFilterWhere(filters),
      },
    });
  }

  /** Period-scoped by `Endorsement.appliedAt` — the moment the policy
   * actually moved to CANCELLED (confirmed in `EndorsementService.apply()`),
   * not `Cancellation.createdAt` (when the cancellation was requested). */
  findCancelledInPeriod(
    filters: PolicyDashboardFilters,
    from: Date,
    to: Date,
  ): Promise<
    {
      policyId: string;
      policyNumber: string | null;
      insuranceLine: string;
      reason: string;
      appliedAt: Date;
    }[]
  > {
    return this.prisma.client.cancellation
      .findMany({
        where: {
          endorsement: {
            appliedAt: { gte: from, lt: to },
            policy: this.policyFilterWhere(filters),
          },
        },
        include: {
          endorsement: {
            include: { policy: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: CANCELLED_POLICIES_READ_LIMIT,
      })
      .then((rows) =>
        rows.map((r) => ({
          policyId: r.endorsement.policy.id,
          policyNumber: r.endorsement.policy.policyNumber,
          insuranceLine: r.endorsement.policy.insuranceLine,
          reason: r.reason,
          appliedAt: r.endorsement.appliedAt!,
        })),
      );
  }
}
