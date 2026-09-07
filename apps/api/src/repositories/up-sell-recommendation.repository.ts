import { Injectable } from '@nestjs/common';
import type { Prisma, UpSellRecommendation, UpSellStatus } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateUpSellRecommendationInput {
  customerId: string;
  /** Fils-precision — already quantized by the service via money.util.ts. */
  currentSumInsured: Prisma.Decimal;
  currentAssetValue: Prisma.Decimal;
  detectedByUserId: string;
}

/**
 * Process 9 — Up-Selling (backlog Part C #9). Owns `UpSellRecommendation`.
 * The "current Sum Insured" side of the comparison comes from
 * `InsuranceProgramRepository`, the "current asset value" side from
 * `RiskProfileRepository` — this repository stays focused on the
 * recommendation rows themselves. `status` is never written here — it moves
 * only through WorkflowTransitionService (A.6); see up-sell.service.ts.
 */
@Injectable()
export class UpSellRecommendationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<UpSellRecommendation | null> {
    return this.prisma.client.upSellRecommendation.findUnique({
      where: { id },
    });
  }

  findManyByCustomerId(
    customerId: string,
    status?: UpSellStatus,
  ): Promise<UpSellRecommendation[]> {
    return this.prisma.client.upSellRecommendation.findMany({
      where: { customerId, status },
      orderBy: { detectedAt: 'desc' },
    });
  }

  /** The customer's most recently *resolved* (CONVERTED/DISMISSED)
   * recommendation, if any — feeds the "don't re-nag until the asset value
   * has grown past what we last flagged" pre-check (up-sell.service.ts).
   * Ordered by `resolvedAt` (always set alongside a CONVERTED/DISMISSED
   * status), not `detectedAt`, so the query states its own intent rather
   * than leaning on the one-OPEN-at-a-time invariant. */
  findLatestResolvedByCustomerId(
    customerId: string,
  ): Promise<UpSellRecommendation | null> {
    return this.prisma.client.upSellRecommendation.findFirst({
      where: { customerId, status: { in: ['CONVERTED', 'DISMISSED'] } },
      orderBy: { resolvedAt: 'desc' },
    });
  }

  /** Inserts one OPEN recommendation. Throws Prisma `P2002` when the
   * customer already has an OPEN one — the caller treats that as "a
   * concurrent scan flagged it first, skip". The partial UNIQUE index
   * (`customerId WHERE status = 'OPEN'`, migration 20260827220000) is the
   * race-safe enforcement (ibms-brain/meta/lex/race-safe-invariants.md);
   * this is the write that hits it. */
  create(
    input: CreateUpSellRecommendationInput,
  ): Promise<UpSellRecommendation> {
    return this.prisma.client.upSellRecommendation.create({ data: input });
  }
}
