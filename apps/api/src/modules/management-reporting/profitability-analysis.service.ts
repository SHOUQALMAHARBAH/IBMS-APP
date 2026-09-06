import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { ProfitabilityPolicyRepository } from '../../repositories/profitability-policy.repository';
import {
  buildProfitabilityAnalysis,
  PROFITABILITY_ANALYSIS_READ_LIMIT,
  type ProfitabilityAnalysisSummary,
} from './profitability-analysis.config';

/**
 * Process 63 — composes the commission-income-vs-cost-to-serve summary. See
 * `profitability-analysis.config.ts` for the pure reduction logic;
 * `ibms-brain/meta/context/profitability-analysis.md` for why `costToServe`
 * is a scoped claims-payout proxy, and why this reuses (not duplicates) the
 * SAME `ProfitabilityPolicyRepository` read #40's `FinancialReportService`
 * already loads.
 */
@Injectable()
export class ProfitabilityAnalysisService {
  private readonly logger = new Logger(ProfitabilityAnalysisService.name);

  constructor(
    private readonly repo: ProfitabilityPolicyRepository,
    private readonly audit: AuditService,
  ) {}

  async summary(actorUserId: string): Promise<ProfitabilityAnalysisSummary> {
    const policies = await this.repo.loadWrittenPolicies(
      PROFITABILITY_ANALYSIS_READ_LIMIT,
    );
    this.warnIfTruncated(policies.length);

    const built = buildProfitabilityAnalysis(policies);
    const summary: ProfitabilityAnalysisSummary = {
      generatedAt: new Date().toISOString(),
      ...built,
    };

    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'ProfitabilityAnalysis',
      entityId: 'summary',
      // the cost-to-serve figure aggregates HIGHLY_CONFIDENTIAL Claim
      // settlement data whenever a settled claim contributed — the #40
      // precedent (`FinancialReportService.recordReadBestEffort`).
      isSensitiveDataAccess: summary.totals.claimCount > 0,
      afterValue: profitabilityAnalysisAuditSnapshot(summary),
    });

    return summary;
  }

  private warnIfTruncated(loaded: number): void {
    if (loaded >= PROFITABILITY_ANALYSIS_READ_LIMIT) {
      this.logger.warn(
        `Profitability analysis: written-policy set truncated at ${PROFITABILITY_ANALYSIS_READ_LIMIT} rows — the commission-income/cost-to-serve breakdowns are partial.`,
      );
    }
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Profitability analysis audit (${input.action} ${input.entityId}) failed after the read completed: ${(err as Error).message}`,
      );
    }
  }
}

function profitabilityAnalysisAuditSnapshot(
  summary: ProfitabilityAnalysisSummary,
): Prisma.InputJsonObject {
  return {
    generatedAt: summary.generatedAt,
    lineCount: summary.byLine.length,
    segmentCount: summary.bySegment.length,
    policyCount: summary.totals.policyCount,
    claimCount: summary.totals.claimCount,
  };
}
