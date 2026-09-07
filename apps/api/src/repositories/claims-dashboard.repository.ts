import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import type { OpenClaimRow } from '../modules/management-reporting/claims-dashboard.config';

export interface ClaimsDashboardFilters {
  ownerUserIds?: string[];
  insuranceLine?: string;
  insurerId?: string;
}

export const CLAIMS_DASHBOARD_READ_LIMIT = 5000;

@Injectable()
export class ClaimsDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserIdsInBranch(branchId: string): Promise<{ id: string }[]> {
    return this.prisma.client.user.findMany({
      where: { branchId },
      select: { id: true },
    });
  }

  private policyFilterWhere(
    filters: ClaimsDashboardFilters,
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

  countClosed(
    filters: ClaimsDashboardFilters,
    createdBefore: Date,
  ): Promise<number> {
    return this.prisma.client.claim.count({
      where: {
        status: 'CLOSED',
        createdAt: { lt: createdBefore },
        policy: this.policyFilterWhere(filters),
      },
    });
  }

  async findOpenClaimsForAgeing(
    filters: ClaimsDashboardFilters,
    createdBefore: Date,
  ): Promise<OpenClaimRow[]> {
    const rows = await this.prisma.client.claim.findMany({
      where: {
        status: { not: 'CLOSED' },
        createdAt: { lt: createdBefore },
        policy: this.policyFilterWhere(filters),
      },
      select: {
        id: true,
        createdAt: true,
        estimatedLoss: true,
        settlement: { select: { netSettlement: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: CLAIMS_DASHBOARD_READ_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      estimatedLoss: r.estimatedLoss,
      netSettlement: r.settlement?.netSettlement ?? null,
    }));
  }
}
