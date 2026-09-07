import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { FinancialDashboardRepository } from '../../repositories/financial-dashboard.repository';
import { InvoiceRepository } from '../../repositories/invoice.repository';
import { FinancialReportRepository } from '../../repositories/financial-report.repository';
import { ProfitabilityPolicyRepository } from '../../repositories/profitability-policy.repository';
import {
  AR_AGEING_INVOICE_LIMIT,
  FINANCIAL_REPORT_ROW_LIMIT,
  INSURER_PAYABLES_ROW_LIMIT,
} from '../finance/finance.config';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import {
  buildFinancialDashboardSummary,
  type FinancialDashboardSummary,
} from './financial-dashboard.config';
import type { FinancialDashboardQueryDto } from './dto/financial-dashboard-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

function utcMidnight(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

@Injectable()
export class FinancialDashboardService {
  private readonly logger = new Logger(FinancialDashboardService.name);

  constructor(
    private readonly repo: FinancialDashboardRepository,
    private readonly invoices: InvoiceRepository,
    private readonly financialReportRepo: FinancialReportRepository,
    private readonly profitabilityPolicyRepo: ProfitabilityPolicyRepository,
    private readonly audit: AuditService,
  ) {}

  async summary(
    query: FinancialDashboardQueryDto,
    actorUserId: string,
  ): Promise<FinancialDashboardSummary> {
    const now = new Date();
    const asOfRaw = query.asOf
      ? parseHistoricalInstant(query.asOf, 'asOf')
      : now;
    const asOf = utcMidnight(asOfRaw);
    const asOfExclusiveUpper = new Date(asOf.getTime() + DAY_MS);

    const ownerUserIds = query.branchId
      ? (await this.repo.findUserIdsInBranch(query.branchId)).map((u) => u.id)
      : undefined;
    const scope = {
      insuranceLine: query.insuranceLine,
      insurerId: query.insurerId,
      ownerUserIds,
    };

    const [
      outstandingInvoices,
      obligations,
      remittances,
      commissionEntries,
      profitabilityPolicies,
    ] = await Promise.all([
      this.invoices.loadOutstandingReceivables({
        ...scope,
        asOfExclusiveUpper,
      }),
      this.invoices.loadInsurerObligations({
        insurerId: scope.insurerId,
        insuranceLine: scope.insuranceLine,
        ownerUserIds: scope.ownerUserIds,
        asOfExclusiveUpper,
      }),
      this.invoices.loadInsurerRemittances({
        insurerId: scope.insurerId,
        asOfExclusiveUpper,
      }),
      this.financialReportRepo.loadCommissionRollupEntries(scope),
      this.profitabilityPolicyRepo.loadWrittenPolicies(
        FINANCIAL_REPORT_ROW_LIMIT,
        scope,
      ),
    ]);

    if (outstandingInvoices.length >= AR_AGEING_INVOICE_LIMIT) {
      this.logger.warn(
        `Financial dashboard receivables read truncated at ${AR_AGEING_INVOICE_LIMIT} invoices — the ageing figures are partial.`,
      );
    }
    if (
      obligations.length >= INSURER_PAYABLES_ROW_LIMIT ||
      remittances.length >= INSURER_PAYABLES_ROW_LIMIT
    ) {
      this.logger.warn(
        `Financial dashboard payables read truncated at ${INSURER_PAYABLES_ROW_LIMIT} rows — the payables figures are partial.`,
      );
    }
    if (commissionEntries.length >= FINANCIAL_REPORT_ROW_LIMIT) {
      this.logger.warn(
        `Financial dashboard commission rollup truncated at ${FINANCIAL_REPORT_ROW_LIMIT} entries — the commission figures are partial.`,
      );
    }
    if (profitabilityPolicies.length >= FINANCIAL_REPORT_ROW_LIMIT) {
      this.logger.warn(
        `Financial dashboard profitability read truncated at ${FINANCIAL_REPORT_ROW_LIMIT} policies — the profitability figures are partial.`,
      );
    }

    const summary = buildFinancialDashboardSummary({
      now,
      asOf,
      outstandingInvoices,
      obligations,
      remittances,
      commissionEntries,
      profitabilityPolicies,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'FinancialDashboard',
      entityId: summary.asOf,
      isSensitiveDataAccess: summary.profitability.totals.claimCount > 0,
      afterValue: financialDashboardAuditSnapshot(summary),
    });

    return summary;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Financial dashboard audit (${input.action} ${input.entityId}) failed after the read completed: ${(err as Error).message}`,
      );
    }
  }
}

function financialDashboardAuditSnapshot(
  summary: FinancialDashboardSummary,
): Prisma.InputJsonObject {
  return {
    asOf: summary.asOf,
    receivableInvoices: summary.receivables.totals.invoiceCount,
    receivableCustomers: summary.receivables.totals.customerCount,
    payableInsurers: summary.payables.totals.insurerCount,
    commissionEntries: summary.commission.entryCount,
    writtenPolicies: summary.profitability.totals.policyCount,
    settledClaims: summary.profitability.totals.claimCount,
  };
}
