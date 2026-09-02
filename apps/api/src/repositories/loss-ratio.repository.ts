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

/** One policy's contribution to the Process 30 aggregate loss-ratio breakdown. */
export interface AnalyticsPolicyRow {
  id: string;
  customerId: string;
  customerLegalName: string;
  insuranceLine: string;
  /** the human-readable policy reference (falls back to the id). */
  policyRef: string;
  /** `issuedPremium ?? requestedPremium`. */
  premium: Prisma.Decimal;
  /** net settlement of each SETTLED / CLOSED claim on the policy (null when unsettled). */
  claimNetSettlements: (Prisma.Decimal | null)[];
}

/** Statuses at which a policy's premium has been written — i.e. everything past
 * `PLACEMENT_CONFIRMED` (which has no bound premium yet). A cancelled / expired
 * policy still contributes its full written premium here — earned-premium is a
 * renewal-module refinement. */
export const ANALYTICS_WRITTEN_POLICY_STATUSES = [
  'ISSUED',
  'CHECKING_IN_PROGRESS',
  'DISCREPANCY',
  'VERIFIED',
  'DELIVERED',
  'ACTIVE',
  'CANCELLED',
  'EXPIRED',
] as const;

/**
 * Cap on the number of policies one aggregate-breakdown query materialises +
 * groups in memory. A broker's whole written book fits comfortably; if a query
 * ever hits this, the report is silently truncated, so the service
 * `logger.warn`s (same shape as the #27 follow-up sweep's
 * `FOLLOWUP_SWEEP_LIMIT`) — the signal to move the aggregation into the DB.
 */
export const ANALYTICS_POLICY_LIMIT = 5000;

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

  /**
   * Process 30 — load every "written" policy (optionally scoped to one
   * customer / line / policy) with its customer name and its SETTLED / CLOSED
   * claim net settlements, for the aggregate loss-ratio breakdown. Book-wide:
   * `claims-analytics.view` is a cross-book reporting permission
   * (`[CLAIMS, MANAGER, EXEC, AUDITOR]`), so there is no per-owner filter.
   */
  async loadPoliciesForAnalytics(scope: {
    customerId?: string;
    insuranceLine?: string;
    policyId?: string;
  }): Promise<AnalyticsPolicyRow[]> {
    const policies = await this.prisma.client.policy.findMany({
      where: {
        status: { in: [...ANALYTICS_WRITTEN_POLICY_STATUSES] },
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
        ...(scope.insuranceLine ? { insuranceLine: scope.insuranceLine } : {}),
        ...(scope.policyId ? { id: scope.policyId } : {}),
      },
      select: {
        id: true,
        customerId: true,
        insuranceLine: true,
        policyNumber: true,
        issuedPremium: true,
        requestedPremium: true,
        customer: { select: { legalName: true } },
        claims: {
          where: { status: { in: ['SETTLED', 'CLOSED'] } },
          select: { settlement: { select: { netSettlement: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: ANALYTICS_POLICY_LIMIT,
    });
    return policies.map((p) => ({
      id: p.id,
      customerId: p.customerId,
      customerLegalName: p.customer.legalName,
      insuranceLine: p.insuranceLine,
      policyRef: p.policyNumber ?? p.id,
      premium: p.issuedPremium ?? p.requestedPremium,
      claimNetSettlements: p.claims.map(
        (c) => c.settlement?.netSettlement ?? null,
      ),
    }));
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
