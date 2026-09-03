import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FINANCIAL_REPORT_ROW_LIMIT,
  type CommissionRollupEntryRow,
  type ProfitabilityPolicyRow,
} from '../modules/finance/finance.config';
import { ANALYTICS_WRITTEN_POLICY_STATUSES } from './loss-ratio.repository';

/**
 * Process 40 — Financial Reporting (backlog Part C #40, Domain D). The two
 * book-wide reads the consolidated summary needs beyond #33 / #34: the
 * commission ledger joined to each policy's insurer, and every written policy
 * with its claims / commission for the profitability section. Wraps
 * `PrismaService` (services depend on repositories in this codebase, never on
 * Prisma directly). Book-wide — `financial-report.view` is a cross-book
 * reporting permission, so there is no per-owner filter. Both reads are capped
 * at `FINANCIAL_REPORT_ROW_LIMIT`; the service `logger.warn`s on truncation
 * (the #30 / #33 precedent).
 */
@Injectable()
export class FinancialReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every `CommissionLedgerEntry` with its policy's insurer id + name — the
   * input to `buildCommissionRollup`. `amount` is the effective commission at
   * every stage (`deriveLedgerEntryView`'s `effectiveAmount` rule). */
  async loadCommissionRollupEntries(): Promise<CommissionRollupEntryRow[]> {
    const rows = await this.prisma.client.commissionLedgerEntry.findMany({
      select: {
        id: true,
        amount: true,
        vatAmount: true,
        paidAmount: true,
        reversedAmount: true,
        status: true,
        policy: {
          select: {
            insurerId: true,
            insurer: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: FINANCIAL_REPORT_ROW_LIMIT,
    });
    return rows.map((r) => ({
      entryId: r.id,
      insurerId: r.policy.insurerId,
      insurerName: r.policy.insurer.name,
      amount: r.amount,
      vatAmount: r.vatAmount,
      paidAmount: r.paidAmount,
      reversedAmount: r.reversedAmount,
      status: r.status,
    }));
  }

  /** Every "written" policy (status past `PLACEMENT_CONFIRMED`) with its
   * customer segment, its SETTLED / CLOSED claim net settlements, and its
   * `CommissionLedgerEntry` figures — the input to `buildProfitability`. */
  async loadProfitabilityPolicies(): Promise<ProfitabilityPolicyRow[]> {
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
      take: FINANCIAL_REPORT_ROW_LIMIT,
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
