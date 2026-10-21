import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RetentionArchiveRepository } from './retention-archive.repository';
import { notBlockedWhere } from '../modules/pdpl/retention-archive.config';
import {
  FINANCIAL_REPORT_ROW_LIMIT,
  type CommissionRollupEntryRow,
} from '../modules/finance/finance.config';
import { INSURER_IDENTITY_SELECT, insurerName } from './insurer-identity';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly archive: RetentionArchiveRepository,
  ) {}

  /** Every `CommissionLedgerEntry` with its policy's insurer id + name — the
   * input to `buildCommissionRollup`. `amount` is the effective commission at
   * every stage (`deriveLedgerEntryView`'s `effectiveAmount` rule).
   *
   * `scope` is a Part E Financial Dashboard (backlog #64) addition — narrowed
   * via `CommissionLedgerEntry.policy` (a required relation, so no orphan
   * exclusion concern the way `Invoice.policy` had). `#40`'s own caller
   * (`FinancialReportService`) never passes it. */
  async loadCommissionRollupEntries(
    scope: {
      insuranceLine?: string;
      insurerId?: string;
      ownerUserIds?: string[];
    } = {},
    now: Date = new Date(),
  ): Promise<CommissionRollupEntryRow[]> {
    // EXCEPT THE BLOCKED ONES (batch 5 group 7c, condition 1). This read carries no date bound at
    // all — it is the office's whole commission book — so without this an entry paid eleven years
    // ago would sit in today's commission position forever, which is the "ongoing processing" a
    // legal block forbids. A NULL `paidAt` — an UNPAID entry, whose clock never started — is KEPT,
    // because `notBlockedWhere` is written as a negation over `lte`; the obvious `gt: cutoff`
    // spelling would have dropped every unpaid commission here and understated what the office is
    // owed, with nothing failing.
    const blocked = await this.archive.blockedExclusionForModel(
      'commissionLedgerEntry',
      now,
    );
    const rows = await this.prisma.client.commissionLedgerEntry.findMany({
      where: {
        ...notBlockedWhere('paidAt', blocked),
        ...(scope.insuranceLine || scope.insurerId || scope.ownerUserIds
          ? {
              policy: {
                is: {
                  ...(scope.insuranceLine
                    ? { insuranceLine: scope.insuranceLine }
                    : {}),
                  ...(scope.insurerId ? { insurerId: scope.insurerId } : {}),
                  ...(scope.ownerUserIds
                    ? { placedByUserId: { in: scope.ownerUserIds } }
                    : {}),
                },
              },
            }
          : {}),
      },
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
            insurer: { select: INSURER_IDENTITY_SELECT },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: FINANCIAL_REPORT_ROW_LIMIT,
    });
    return rows.map((r) => ({
      entryId: r.id,
      insurerId: r.policy.insurerId,
      insurerName: insurerName(r.policy.insurer),
      amount: r.amount,
      vatAmount: r.vatAmount,
      paidAmount: r.paidAmount,
      reversedAmount: r.reversedAmount,
      status: r.status,
    }));
  }
}
