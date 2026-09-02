import { Injectable } from '@nestjs/common';
import type { LossRatio, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface PolicyLossRatioInputs {
  id: string;
  /** `issuedPremium ?? requestedPremium` — the premium the ratio is measured against. */
  premium: Prisma.Decimal;
  /** the policy's `RenewalCase` id (1:1 with the `Policy`), or null when it has
   * none yet — the renewal module is not built. Selected with no status filter;
   * that predicate is the renewal module's to own. */
  renewalCaseId: string | null;
  /** net settlement of each SETTLED / CLOSED claim on the policy (null when unsettled). */
  claimNetSettlements: (Prisma.Decimal | null)[];
}

/**
 * Process 29 — the two `LossRatio` recompute queries, wrapping `PrismaService`
 * (services depend on repositories in this codebase, never on Prisma directly).
 */
@Injectable()
export class LossRatioRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadPolicyForRecompute(
    policyId: string,
  ): Promise<PolicyLossRatioInputs | null> {
    const policy = await this.prisma.client.policy.findUnique({
      where: { id: policyId },
      select: {
        id: true,
        issuedPremium: true,
        requestedPremium: true,
        renewalCase: { select: { id: true } },
        claims: {
          where: { status: { in: ['SETTLED', 'CLOSED'] } },
          select: { settlement: { select: { netSettlement: true } } },
        },
      },
    });
    if (!policy) return null;
    return {
      id: policy.id,
      premium: policy.issuedPremium ?? policy.requestedPremium,
      renewalCaseId: policy.renewalCase?.id ?? null,
      claimNetSettlements: policy.claims.map(
        (c) => c.settlement?.netSettlement ?? null,
      ),
    };
  }

  upsertLossRatio(
    renewalCaseId: string,
    figures: {
      periodClaims: Prisma.Decimal;
      periodPremium: Prisma.Decimal;
      ratio: Prisma.Decimal;
    },
  ): Promise<LossRatio> {
    return this.prisma.client.lossRatio.upsert({
      where: { renewalCaseId },
      create: {
        renewalCaseId,
        periodClaims: figures.periodClaims,
        periodPremium: figures.periodPremium,
        ratio: figures.ratio,
      },
      update: {
        periodClaims: figures.periodClaims,
        periodPremium: figures.periodPremium,
        ratio: figures.ratio,
        computedAt: new Date(),
      },
    });
  }
}
