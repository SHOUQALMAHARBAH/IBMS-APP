import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { ANALYTICS_WRITTEN_POLICY_STATUSES } from './loss-ratio.repository';

/** One written policy's contribution to a profitability breakdown. Shared
 * between #40 (`FinancialReportService`'s premium/claims/commission
 * `netPosition`) and #63 (`ProfitabilityAnalysisService`'s commission-income-
 * vs-cost-to-serve view) — both need the identical raw shape, grouped
 * differently. Promoted out of `financial-report.repository.ts` into its own
 * file once #63 needed the same query, the `common/period.util.ts` /
 * `common/money.util.ts` promotion pattern (#61/#62) applied to a repository
 * query instead of a pure utility function. */
export interface ProfitabilityPolicyRow {
  policyId: string;
  insuranceLine: string;
  /** `CustomerType` — `'CORPORATE'` | `'INDIVIDUAL'`. */
  customerType: string;
  /** `issuedPremium ?? requestedPremium` — written premium (a cancelled /
   * expired policy still contributes its full written premium; earned-premium
   * proration is a renewal-module refinement, the #30 assumption). */
  premium: Prisma.Decimal | string;
  /** net settlement of each SETTLED / CLOSED claim on the policy (null when
   * unsettled). HIGHLY_CONFIDENTIAL source — the caller records a READ. */
  claimNetSettlements: (Prisma.Decimal | string | null)[];
  /** the policy's `CommissionLedgerEntry` effective `amount`, or null. */
  commissionAmount: Prisma.Decimal | string | null;
  /** accumulated clawback on that entry, or null. */
  commissionReversedAmount: Prisma.Decimal | string | null;
}

/**
 * Every "written" policy (status past `PLACEMENT_CONFIRMED`) with its
 * customer segment, its SETTLED / CLOSED claim net settlements, and its
 * `CommissionLedgerEntry` figures. Book-wide, no per-owner filter — both
 * consumers gate on a cross-book reporting permission. Capped at the
 * caller-supplied `limit`; the caller `logger.warn`s on truncation (the #30 /
 * #33 precedent).
 */
@Injectable()
export class ProfitabilityPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadWrittenPolicies(limit: number): Promise<ProfitabilityPolicyRow[]> {
    const policies = await this.prisma.client.policy.findMany({
      where: { status: { in: [...ANALYTICS_WRITTEN_POLICY_STATUSES] } },
      select: {
        id: true,
        insuranceLine: true,
        issuedPremium: true,
        requestedPremium: true,
        customer: { select: { customerType: true } },
        claims: {
          where: { status: { in: ['SETTLED', 'CLOSED'] } },
          select: { settlement: { select: { netSettlement: true } } },
        },
        commissionLedgerEntries: {
          select: { amount: true, reversedAmount: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return policies.map((p) => {
      // `@@unique([policyId])` on CommissionLedgerEntry — 0 or 1 per policy.
      const entry = p.commissionLedgerEntries[0] ?? null;
      return {
        policyId: p.id,
        insuranceLine: p.insuranceLine,
        customerType: p.customer.customerType,
        premium: p.issuedPremium ?? p.requestedPremium,
        claimNetSettlements: p.claims.map(
          (c) => c.settlement?.netSettlement ?? null,
        ),
        commissionAmount: entry?.amount ?? null,
        commissionReversedAmount: entry?.reversedAmount ?? null,
      };
    });
  }
}
