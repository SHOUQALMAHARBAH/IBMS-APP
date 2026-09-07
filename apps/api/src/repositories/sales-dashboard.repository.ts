import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface SalesDashboardFilters {
  ownerUserIds?: string[];
  insuranceLine?: string;
  insurerId?: string;
}

/** Part E Sales Dashboard — reads Lead/Policy/CommissionLedgerEntry/
 * CrossSellOpportunity/UpSellRecommendation directly (no cross-module
 * service dependency, the #58 KPI Dashboard shape). See
 * `sales-dashboard.config.ts`'s header comment for which filter applies to
 * which metric. */
@Injectable()
export class SalesDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves a branch to the concrete `User.branchId` set — the #59 Sales
   * Performance precedent. */
  findUserIdsInBranch(branchId: string): Promise<{ id: string }[]> {
    return this.prisma.client.user.findMany({
      where: { branchId },
      select: { id: true },
    });
  }

  countNewLeads(
    ownerUserIds: string[] | undefined,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.client.lead.count({
      where: {
        createdAt: { gte: from, lt: to },
        ...(ownerUserIds ? { ownerUserId: { in: ownerUserIds } } : {}),
      },
    });
  }

  countConvertedToProspectLeads(
    ownerUserIds: string[] | undefined,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.client.lead.count({
      where: {
        createdAt: { gte: from, lt: to },
        status: 'CONVERTED_TO_PROSPECT',
        ...(ownerUserIds ? { ownerUserId: { in: ownerUserIds } } : {}),
      },
    });
  }

  private policyWhere(
    filters: SalesDashboardFilters,
    from: Date,
    to: Date,
    isRenewal: boolean,
  ): Prisma.PolicyWhereInput {
    return {
      createdAt: { gte: from, lt: to },
      opportunity: { isRenewal },
      ...(filters.ownerUserIds
        ? { placedByUserId: { in: filters.ownerUserIds } }
        : {}),
      ...(filters.insuranceLine
        ? { insuranceLine: filters.insuranceLine }
        : {}),
      ...(filters.insurerId ? { insurerId: filters.insurerId } : {}),
    };
  }

  async sumIssuedPremium(
    filters: SalesDashboardFilters,
    from: Date,
    to: Date,
    isRenewal: boolean,
  ): Promise<Prisma.Decimal | null> {
    const result = await this.prisma.client.policy.aggregate({
      where: this.policyWhere(filters, from, to, isRenewal),
      _sum: { issuedPremium: true },
    });
    return result._sum.issuedPremium;
  }

  async sumCommission(
    filters: SalesDashboardFilters,
    from: Date,
    to: Date,
  ): Promise<Prisma.Decimal | null> {
    const result = await this.prisma.client.commissionLedgerEntry.aggregate({
      where: {
        createdAt: { gte: from, lt: to },
        policy: {
          ...(filters.ownerUserIds
            ? { placedByUserId: { in: filters.ownerUserIds } }
            : {}),
          ...(filters.insuranceLine
            ? { insuranceLine: filters.insuranceLine }
            : {}),
          ...(filters.insurerId ? { insurerId: filters.insurerId } : {}),
        },
      },
      _sum: { amount: true },
    });
    return result._sum.amount;
  }

  countCrossSellOpportunities(
    gapLine: string | undefined,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.client.crossSellOpportunity.count({
      where: {
        detectedAt: { gte: from, lt: to },
        ...(gapLine ? { gapLine } : {}),
      },
    });
  }

  countCrossSellConverted(
    gapLine: string | undefined,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.client.crossSellOpportunity.count({
      where: {
        detectedAt: { gte: from, lt: to },
        status: 'CONVERTED',
        ...(gapLine ? { gapLine } : {}),
      },
    });
  }

  countUpSellRecommendations(from: Date, to: Date): Promise<number> {
    return this.prisma.client.upSellRecommendation.count({
      where: { detectedAt: { gte: from, lt: to } },
    });
  }

  countUpSellConverted(from: Date, to: Date): Promise<number> {
    return this.prisma.client.upSellRecommendation.count({
      where: { detectedAt: { gte: from, lt: to }, status: 'CONVERTED' },
    });
  }
}
