import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import { ClientAccountingService } from './client-accounting.service';
import { InsurerAccountingService } from './insurer-accounting.service';
import { FinancialReportRepository } from '../../repositories/financial-report.repository';
import {
  buildCommissionRollup,
  buildProfitability,
  FINANCIAL_REPORT_ROW_LIMIT,
  type FinancialReportSummary,
} from './finance.config';

export interface FinancialReportQuery {
  /** `YYYY-MM-DD`, today or earlier. Default: today. Point-in-time for the
   * receivables + payables sections only. */
  asOf?: string;
}

/**
 * Process 40 (backlog Part C #40, Domain D) — Financial Reporting. The
 * consolidated "Financial Dashboard" (Part E dashboard D) summary, computed on
 * the fly:
 *
 *   - `receivables` — #33's `GET /client-accounting/ageing` totals (AR + ageing
 *     buckets), point-in-time at `asOf`.
 *   - `payables`    — #34's `GET /insurer-accounting/payables` totals
 *     (owed to / remitted from insurers), point-in-time at `asOf`.
 *   - `commission`  — the commission income roll-up over `CommissionLedgerEntry`
 *     (earned / paid / outstanding / reversed, totals + by insurer) — the
 *     "AP-style roll-up by insurer" #36 deferred here. Current-state.
 *   - `profitability` — every written policy grouped by line and by customer
 *     segment, with `netPosition = premiumWritten − claimsPaid −
 *     commissionEarned`. Current-state.
 *
 * `financial-report.view` is a cross-book reporting permission
 * (`[FINANCE_COLLECTIONS_OFFICER, BRANCH_DEPARTMENT_MANAGER,
 * EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]`), so the query is book-wide with no
 * per-owner filter. No maker/checker (a read). The profitability section
 * aggregates SETTLED / CLOSED `Claim` net settlements (HIGHLY_CONFIDENTIAL), so
 * — like #30 Claims Analytics — the service writes a best-effort `READ` audit
 * row (counts / `asOf` only, never a figure or a name).
 */
@Injectable()
export class FinancialReportService {
  private readonly logger = new Logger(FinancialReportService.name);

  constructor(
    private readonly clientAccounting: ClientAccountingService,
    private readonly insurerAccounting: InsurerAccountingService,
    private readonly repo: FinancialReportRepository,
    private readonly audit: AuditService,
  ) {}

  async summary(
    query: FinancialReportQuery,
    actorUserId: string,
  ): Promise<FinancialReportSummary> {
    // Normalise `asOf` once here — `parseHistoricalInstant` 422s a future date,
    // and we then pass the CANONICAL bare `YYYY-MM-DD` down to both sub-services
    // (rather than the raw / possibly-omitted input), so all three parse the
    // identical string — no drift if the request straddles UTC midnight with
    // `asOf` omitted.
    const asOfRaw = query.asOf
      ? parseHistoricalInstant(query.asOf, 'asOf')
      : new Date();
    const asOfMidnight = new Date(
      Date.UTC(
        asOfRaw.getUTCFullYear(),
        asOfRaw.getUTCMonth(),
        asOfRaw.getUTCDate(),
      ),
    );
    const asOf = asOfMidnight.toISOString();
    const asOfDate = asOf.slice(0, 10);

    const [ageing, payables, commissionEntries, profitabilityPolicies] =
      await Promise.all([
        this.clientAccounting.receivablesAgeing({ asOf: asOfDate }),
        this.insurerAccounting.payables({ asOf: asOfDate }),
        this.repo.loadCommissionRollupEntries(),
        this.repo.loadProfitabilityPolicies(),
      ]);

    if (commissionEntries.length >= FINANCIAL_REPORT_ROW_LIMIT) {
      this.logger.warn(
        `Financial-report summary: commission ledger truncated at ${FINANCIAL_REPORT_ROW_LIMIT} entries — the commission roll-up is partial; move the aggregation into the query.`,
      );
    }
    if (profitabilityPolicies.length >= FINANCIAL_REPORT_ROW_LIMIT) {
      this.logger.warn(
        `Financial-report summary: written-policy set truncated at ${FINANCIAL_REPORT_ROW_LIMIT} policies — the profitability section is partial; move the aggregation into the query.`,
      );
    }

    const commission = buildCommissionRollup(commissionEntries);
    const profitability = buildProfitability(profitabilityPolicies);

    await this.recordReadBestEffort(actorUserId, {
      view: 'financial-report-summary',
      asOf,
      receivableCustomers: ageing.totals.customerCount,
      receivableInvoices: ageing.totals.invoiceCount,
      payableInsurers: payables.totals.insurerCount,
      commissionEntries: commission.entryCount,
      writtenPolicies: profitability.totals.policyCount,
      settledClaims: profitability.totals.claimCount,
    });

    return {
      asOf,
      currency: 'JOD',
      receivables: {
        outstandingTotal: ageing.totals.outstandingTotal,
        current: ageing.totals.current,
        d1_30: ageing.totals.d1_30,
        d31_60: ageing.totals.d31_60,
        d61_90: ageing.totals.d61_90,
        d90_plus: ageing.totals.d90_plus,
        invoiceCount: ageing.totals.invoiceCount,
        customerCount: ageing.totals.customerCount,
      },
      payables: {
        outstandingAmount: payables.totals.outstandingAmount,
        outstandingCount: payables.totals.outstandingCount,
        remittedAmount: payables.totals.remittedAmount,
        remittedCount: payables.totals.remittedCount,
        insurerCount: payables.totals.insurerCount,
      },
      commission,
      profitability,
    };
  }

  private async recordReadBestEffort(
    userId: string,
    afterValue: Prisma.InputJsonObject & { settledClaims: number },
  ): Promise<void> {
    try {
      await this.audit.record({
        userId,
        action: 'READ',
        entityType: 'FinancialReport',
        entityId: 'summary',
        // the profitability section touched HIGHLY_CONFIDENTIAL Claim rows
        // whenever a settled claim contributed (mirrors ClaimsAnalyticsService)
        isSensitiveDataAccess: afterValue.settledClaims > 0,
        afterValue,
      });
    } catch (err) {
      this.logger.error(
        `Financial-report READ audit did not write: ${(err as Error).message}`,
      );
    }
  }
}
