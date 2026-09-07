import { previousUtcMonthRange } from '../../common/period.util';
import type { PortfolioBreakdownRow } from './portfolio-analysis.config';
import type { InsurerPerformanceScoreView } from './insurer-performance.config';

/**
 * Process 65 (backlog Part C #65, Domain G — the last built Domain G item)
 * — "Strategic Planning Inputs: export portfolio/market data for planning
 * cycles." The backlog names no new metric at all — this process composes
 * TWO already-built reports into one export payload:
 *
 *   - `portfolio` — the SAME four breakdowns #62 (`PortfolioAnalysisService.
 *     summary()`) already computes (byLine/byInsurer/byClientSegment/
 *     byGeography), a current-state snapshot with no period.
 *   - `market` — every insurer's `InsurerPerformanceScore` (#60) for ONE
 *     period — quote-response speed/claims service/price/service quality,
 *     the closest existing signal for "the state of the market this broker
 *     places business with."
 *
 * **Reused via REPOSITORY, never via SERVICE** — this codebase's universal
 * cross-module rule (every `XModule` that needs another domain's data
 * imports that OTHER module for its REPOSITORY export only — e.g.
 * `CustomerModule` exports only `CustomerRepository`, never
 * `CustomerService`; #63 extended this to a repository SHARED, provided
 * independently, by two different modules). `PlanningExportService`
 * provides its OWN instances of `PortfolioAnalysisRepository` and
 * `InsurerPerformanceRepository` (no `imports`/`exports` touched on either
 * existing module) and reuses their pure derivation functions
 * (`deriveLineOrInsurerBreakdown` etc., `deriveInsurerPerformanceScoreView`)
 * directly — the actual REDUCTION logic is never duplicated, only the thin
 * `Promise.all` + name-resolution orchestration glue every composing report
 * in this codebase (e.g. #40's own `FinancialReportService.summary()`)
 * already repeats for itself.
 */

export interface PlanningExportPortfolio {
  byLine: PortfolioBreakdownRow[];
  byInsurer: PortfolioBreakdownRow[];
  byClientSegment: PortfolioBreakdownRow[];
  byGeography: PortfolioBreakdownRow[];
}

export interface PlanningExportSummary {
  generatedAt: string;
  /** the UTC calendar month the `market` section scores — `portfolio` is
   * always a current-state snapshot regardless of this value. */
  periodLabel: string;
  portfolio: PlanningExportPortfolio;
  market: InsurerPerformanceScoreView[];
}

/** Pure: an explicit override wins; otherwise the same "previous UTC
 * calendar month" default #60/#61 already use for their own periodic
 * reads — a monthly score is only meaningful once the month has elapsed. */
export function resolvePeriodLabel(
  override: string | undefined,
  now: Date,
): string {
  return override ?? previousUtcMonthRange(now).periodLabel;
}
