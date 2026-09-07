import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { PortfolioAnalysisRepository } from '../../repositories/portfolio-analysis.repository';
import {
  deriveLineOrInsurerBreakdown,
  PORTFOLIO_ANALYSIS_READ_LIMIT,
  reduceByClientSegment,
  reduceByGeography,
  type PortfolioAnalysisSummary,
} from './portfolio-analysis.config';

/**
 * Process 62 — composes the four breakdowns into one summary. See
 * `portfolio-analysis.config.ts` for the pure reduction/formatting logic;
 * `ibms-brain/meta/context/portfolio-analysis.md` for why two breakdowns
 * are real `groupBy` calls and two are a capped `findMany` reduced here.
 */
@Injectable()
export class PortfolioAnalysisService {
  private readonly logger = new Logger(PortfolioAnalysisService.name);

  constructor(
    private readonly repo: PortfolioAnalysisRepository,
    private readonly audit: AuditService,
  ) {}

  async summary(actorUserId: string): Promise<PortfolioAnalysisSummary> {
    const [lineGroups, insurerGroups, crossTableRows] = await Promise.all([
      this.repo.groupByLine(),
      this.repo.groupByInsurerId(),
      this.repo.findPoliciesForCrossTableGrouping(
        PORTFOLIO_ANALYSIS_READ_LIMIT,
      ),
    ]);

    this.warnIfTruncated(crossTableRows.length);

    const insurerNames = await this.repo.findInsurerNames(
      insurerGroups.map((g) => g.key),
    );
    const insurerNameById = new Map(insurerNames.map((i) => [i.id, i.name]));

    const ownerUserIds = [...new Set(crossTableRows.map((r) => r.ownerUserId))];
    const branchNameByOwner =
      await this.repo.findBranchNamesForOwners(ownerUserIds);

    const summary: PortfolioAnalysisSummary = {
      generatedAt: new Date().toISOString(),
      byLine: deriveLineOrInsurerBreakdown(lineGroups),
      byInsurer: deriveLineOrInsurerBreakdown(insurerGroups, insurerNameById),
      byClientSegment: reduceByClientSegment(crossTableRows),
      byGeography: reduceByGeography(crossTableRows, branchNameByOwner),
    };

    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'PortfolioAnalysis',
      entityId: 'summary',
      afterValue: portfolioAnalysisAuditSnapshot(summary),
    });

    return summary;
  }

  private warnIfTruncated(loaded: number): void {
    if (loaded >= PORTFOLIO_ANALYSIS_READ_LIMIT) {
      this.logger.warn(
        `Portfolio analysis: policy set truncated at ${PORTFOLIO_ANALYSIS_READ_LIMIT} rows for the client-segment/geography breakdowns — those two figures are partial.`,
      );
    }
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Portfolio analysis audit (${input.action} ${input.entityId}) failed after the read completed: ${(err as Error).message}`,
      );
    }
  }
}

function portfolioAnalysisAuditSnapshot(
  summary: PortfolioAnalysisSummary,
): Prisma.InputJsonObject {
  return {
    generatedAt: summary.generatedAt,
    lineCount: summary.byLine.length,
    insurerCount: summary.byInsurer.length,
    clientSegmentCount: summary.byClientSegment.length,
    geographyCount: summary.byGeography.length,
  };
}
