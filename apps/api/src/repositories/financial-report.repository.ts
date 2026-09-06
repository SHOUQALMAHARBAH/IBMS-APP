import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FINANCIAL_REPORT_ROW_LIMIT,
  type CommissionRollupEntryRow,
} from '../modules/finance/finance.config';

/**
 * Process 40 — Financial Reporting (backlog Part C #40, Domain D). The
 * commission ledger joined to each policy's insurer — the input to
 * `buildCommissionRollup`. The profitability section's own written-policy
 * read lives at `ProfitabilityPolicyRepository` (promoted out of this file
 * once #63 needed the identical query). Wraps `PrismaService` (services
 * depend on repositories in this codebase, never on Prisma directly).
 * Book-wide — `financial-report.view` is a cross-book reporting permission,
 * so there is no per-owner filter. Capped at `FINANCIAL_REPORT_ROW_LIMIT`;
 * the service `logger.warn`s on truncation (the #30 / #33 precedent).
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
}
