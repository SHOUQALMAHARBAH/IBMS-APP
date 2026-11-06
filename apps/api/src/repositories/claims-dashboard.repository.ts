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

  /**
   * ## `discardedAt: null` IS HERE SO THE TWO COUNTERS AGREE — ADDED 2026-11-06 (module 0-c batch 6)
   *
   * `findOpenClaimsForAgeing` below excludes discarded claims and says why. This one did not, and
   * the two figures are rendered as the two halves of ONE proportion: `/dashboards/claims` draws a
   * `Ring` whose total is `openClaimsCount + closedClaimsCount`, captioned with the owner's own
   * «{open} مطالبة مفتوحة من {total}» — *N open claims OF total*. Two filters that disagree about
   * which claims exist cannot be the two halves of one total.
   *
   * **MEASURED FIRST, AND IT CHANGES NO FIGURE TODAY — the asymmetry is LATENT, not live.** A claim
   * is discardable only while `status === 'NOTIFIED'` (`discard.config.ts`: *"NOTIFIED means the
   * client told us. REGISTERED means we told the insurer"*), and `WorkflowTransitionService` refuses
   * to advance a discarded record — so a discarded claim is NOTIFIED forever and can never BE
   * `CLOSED`. Measured on the dev database 2026-11-06: 31 claims, **0 discarded, 0 closed, 0 both**.
   *
   * So this is written as a guard against a change somewhere else, not as a repair of a wrong
   * number: the day the commitment rule moves — a claim discardable after registration, or a
   * CLOSED claim withdrawn — the closed half would start counting withdrawn claims while the open
   * half did not, and the ring's denominator would silently stop being a denominator. The filter
   * costs nothing and removes the whole class.
   *
   * **What it does NOT fix, stated rather than left to look covered:** `open + closed` still is not
   * *the office's claims* — it is the office's claims MINUS the withdrawn ones, consistently now
   * rather than inconsistently. Whether the caption should say so is a sentence, and the sentence
   * is the owner's.
   */
  countClosed(
    filters: ClaimsDashboardFilters,
    createdBefore: Date,
  ): Promise<number> {
    return this.prisma.client.claim.count({
      where: {
        status: 'CLOSED',
        discardedAt: null,
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
        // A discarded claim is NOTIFIED forever and would age here without limit — the one row in an ageing
        // report guaranteed to look worst is the one that was withdrawn.
        discardedAt: null,
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
