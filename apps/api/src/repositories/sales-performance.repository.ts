import { Injectable } from '@nestjs/common';
import type { SalesTarget } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateSalesTargetInput {
  ownerUserId: string | null;
  branchId: string | null;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  targetNewProspects: number;
  createdByUserId: string;
}

export interface SalesTargetScope {
  ownerUserId?: string;
  branchId?: string;
}

/**
 * Process 59 — owns `SalesTarget` plus the live "actual" counts
 * `SalesPerformanceService` compares a target against. The actual side is
 * never persisted — `countNewLeads`/`countNewProspects` re-run at read time
 * against `Lead`/`Prospect`, scoped to either one owner (`ownerUserId`) or
 * every user in one branch (`userIds` resolved from `Branch` by the
 * service). "New" = created inside `[periodStart, periodEnd)`, the
 * exact half-open window used everywhere else a period is checked in this
 * codebase (e.g. `startOfCurrentUtcMonth` in `kpi-dashboard.config.ts`).
 */
@Injectable()
export class SalesPerformanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateSalesTargetInput): Promise<SalesTarget> {
    return this.prisma.client.salesTarget.create({ data: input });
  }

  updateTargetValue(
    id: string,
    targetNewProspects: number,
  ): Promise<SalesTarget> {
    return this.prisma.client.salesTarget.update({
      where: { id },
      data: { targetNewProspects },
    });
  }

  findById(id: string): Promise<SalesTarget | null> {
    return this.prisma.client.salesTarget.findUnique({ where: { id } });
  }

  findByScopeAndLabel(
    scope: SalesTargetScope,
    periodLabel: string,
  ): Promise<SalesTarget | null> {
    return this.prisma.client.salesTarget.findFirst({
      where: { ...scope, periodLabel },
    });
  }

  /** The target whose window contains `at` for this exact scope — a Sales
   * Officer/Manager asking "how am I doing right now" with no explicit
   * `periodLabel`. `null` (no current target set) is an expected, valid
   * state at this feature's genesis, not an error. */
  findCurrent(scope: SalesTargetScope, at: Date): Promise<SalesTarget | null> {
    return this.prisma.client.salesTarget.findFirst({
      where: { ...scope, periodStart: { lte: at }, periodEnd: { gt: at } },
      orderBy: { periodStart: 'desc' },
    });
  }

  findMany(scope: SalesTargetScope): Promise<SalesTarget[]> {
    return this.prisma.client.salesTarget.findMany({
      where: { ...scope },
      orderBy: { periodStart: 'desc' },
    });
  }

  /** Every user in one branch — resolves a "team" scope to the concrete
   * `ownerUserId`s `countNewLeads`/`countNewProspects` filter by. */
  findUserIdsInBranch(branchId: string): Promise<{ id: string }[]> {
    return this.prisma.client.user.findMany({
      where: { branchId },
      select: { id: true },
    });
  }

  countNewLeads(ownerUserIds: string[], from: Date, to: Date): Promise<number> {
    return this.prisma.client.lead.count({
      where: {
        ownerUserId: { in: ownerUserIds },
        createdAt: { gte: from, lt: to },
      },
    });
  }

  countNewProspects(
    ownerUserIds: string[],
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.client.prospect.count({
      where: {
        salesOwnerUserId: { in: ownerUserIds },
        createdAt: { gte: from, lt: to },
      },
    });
  }
}
