import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { PortfolioAnalysisRepository } from '../../repositories/portfolio-analysis.repository';
import { InsurerPerformanceRepository } from '../../repositories/insurer-performance.repository';
import {
  deriveLineOrInsurerBreakdown,
  PORTFOLIO_ANALYSIS_READ_LIMIT,
  reduceByClientSegment,
  reduceByGeography,
} from './portfolio-analysis.config';
import { deriveInsurerPerformanceScoreView } from './insurer-performance.config';
import {
  resolvePeriodLabel,
  type PlanningExportSummary,
} from './planning-export.config';

/**
 * Process 65 — composes the portfolio + market export payload. See
 * `planning-export.config.ts` for the pure period-resolution helper and why
 * this reuses (not duplicates) #62's/#60's own repositories + derivation
 * functions rather than injecting their services.
 */
@Injectable()
export class PlanningExportService {
  private readonly logger = new Logger(PlanningExportService.name);

  constructor(
    private readonly portfolioRepo: PortfolioAnalysisRepository,
    private readonly insurerPerformanceRepo: InsurerPerformanceRepository,
    private readonly audit: AuditService,
  ) {}

  async generate(
    actorUserId: string,
    periodLabelOverride: string | undefined,
  ): Promise<PlanningExportSummary> {
    const periodLabel = resolvePeriodLabel(periodLabelOverride, new Date());

    const [lineGroups, insurerGroups, crossTableRows, marketRows] =
      await Promise.all([
        this.portfolioRepo.groupByLine(),
        this.portfolioRepo.groupByInsurerId(),
        this.portfolioRepo.findPoliciesForCrossTableGrouping(
          PORTFOLIO_ANALYSIS_READ_LIMIT,
        ),
        this.insurerPerformanceRepo.findMany({ periodLabel }),
      ]);

    this.warnIfTruncated(crossTableRows.length);

    const insurerNames = await this.portfolioRepo.findInsurerNames(
      insurerGroups.map((g) => g.key),
    );
    const insurerNameById = new Map(insurerNames.map((i) => [i.id, i.name]));

    const ownerUserIds = [...new Set(crossTableRows.map((r) => r.ownerUserId))];
    const branchNameByOwner =
      await this.portfolioRepo.findBranchNamesForOwners(ownerUserIds);

    const summary: PlanningExportSummary = {
      generatedAt: new Date().toISOString(),
      periodLabel,
      portfolio: {
        byLine: deriveLineOrInsurerBreakdown(lineGroups),
        byInsurer: deriveLineOrInsurerBreakdown(insurerGroups, insurerNameById),
        byClientSegment: reduceByClientSegment(crossTableRows),
        byGeography: reduceByGeography(crossTableRows, branchNameByOwner),
      },
      market: marketRows.map(deriveInsurerPerformanceScoreView),
    };

    await this.safeAudit({
      userId: actorUserId,
      action: 'EXPORT',
      entityType: 'PlanningExport',
      entityId: periodLabel,
      afterValue: planningExportAuditSnapshot(summary),
    });

    return summary;
  }

  private warnIfTruncated(loaded: number): void {
    if (loaded >= PORTFOLIO_ANALYSIS_READ_LIMIT) {
      this.logger.warn(
        `Planning export: policy set truncated at ${PORTFOLIO_ANALYSIS_READ_LIMIT} rows for the client-segment/geography breakdowns — those two figures are partial.`,
      );
    }
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Planning export audit (${input.action} ${input.entityId}) failed after the export completed: ${(err as Error).message}`,
      );
    }
  }
}

function planningExportAuditSnapshot(
  summary: PlanningExportSummary,
): Prisma.InputJsonObject {
  return {
    generatedAt: summary.generatedAt,
    periodLabel: summary.periodLabel,
    lineCount: summary.portfolio.byLine.length,
    insurerCount: summary.portfolio.byInsurer.length,
    marketRowCount: summary.market.length,
  };
}
