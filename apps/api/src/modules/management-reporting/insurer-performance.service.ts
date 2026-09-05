import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { InsurerPerformanceRepository } from '../../repositories/insurer-performance.repository';
import { parseCalendarDate } from '../../common/calendar-date.util';
import {
  clampScore,
  daysBetween,
  DEFAULT_QUOTE_RESPONSE_TARGET_DAYS,
  deriveInsurerPerformanceScoreView,
  NEUTRAL_SCORE,
  previousUtcMonthRange,
  priceCompetitivenessScore,
  scoreFromAverageDays,
  scoreFromProportion,
  type InsurerPerformanceScoreView,
  type PeriodWindow,
} from './insurer-performance.config';
import type { ListInsurerPerformanceQueryDto } from './dto/list-insurer-performance-query.dto';
import type { ComputeInsurerPerformanceDto } from './dto/compute-insurer-performance.dto';

export interface ComputeScoresResult {
  periodLabel: string;
  insurersComputed: number;
  insurersFailed: number;
}

/** How many insurers `computeScores` scores concurrently per chunk — bounded
 * so a large book never opens one connection per insurer at once. */
const COMPUTE_CONCURRENCY = 20;

/**
 * Process 60 — computes and reads `InsurerPerformanceScore`. See
 * `insurer-performance.config.ts` for the pure per-dimension math;
 * `ibms-brain/meta/context/insurer-performance.md` for why each dimension's
 * metric was picked and why a dimension with no data this period falls back
 * to `NEUTRAL_SCORE` rather than 0 or 100.
 */
@Injectable()
export class InsurerPerformanceService {
  private readonly logger = new Logger(InsurerPerformanceService.name);

  constructor(
    private readonly repo: InsurerPerformanceRepository,
    private readonly audit: AuditService,
  ) {}

  /** No fields -> the UTC calendar month that just ended (what the
   * scheduler itself passes). All three fields -> that explicit window
   * (a backfill, or an e2e test that can't wait on a real calendar month).
   * Any other combination is incoherent — 422. */
  resolvePeriodFromDto(dto: ComputeInsurerPerformanceDto): PeriodWindow {
    const provided = [dto.periodLabel, dto.periodStart, dto.periodEnd].filter(
      (v) => v !== undefined,
    ).length;
    if (provided === 0) return previousUtcMonthRange(new Date());
    if (provided !== 3) {
      throw new UnprocessableEntityException(
        'periodLabel, periodStart, and periodEnd must all be supplied together, or all omitted for the previous calendar month',
      );
    }
    const periodStart = parseCalendarDate(dto.periodStart!, 'periodStart');
    const periodEnd = parseCalendarDate(dto.periodEnd!, 'periodEnd');
    if (periodEnd.getTime() <= periodStart.getTime()) {
      throw new UnprocessableEntityException(
        'periodEnd must be after periodStart',
      );
    }
    return { periodLabel: dto.periodLabel!, periodStart, periodEnd };
  }

  /** Computes and upserts every insurer's score for one period — the
   * scheduler's own job, never exposed as an HTTP "run for everybody"
   * trigger (`InsurerPerformanceController.compute` always names one
   * insurer, the `up-sell-recommendations/detect` shape). Runs in bounded
   * chunks of `COMPUTE_CONCURRENCY`, not fully sequential (the #56 lesson —
   * a real book could grow to hundreds of insurers) nor fully unbounded
   * (thousands of simultaneous connections would exhaust the Postgres pool
   * instead of speeding anything up). Per-insurer isolation within a chunk
   * (`Promise.allSettled`, the `UpSellDetectionScheduler` shape): one
   * insurer failing must not abandon the rest of the run. */
  async computeScores(
    period: PeriodWindow,
    actorUserId: string,
  ): Promise<ComputeScoresResult> {
    const insurerIds = (await this.repo.listInsurerIds()).map((i) => i.id);

    let insurersComputed = 0;
    let insurersFailed = 0;
    for (let i = 0; i < insurerIds.length; i += COMPUTE_CONCURRENCY) {
      const chunk = insurerIds.slice(i, i + COMPUTE_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((insurerId) =>
          this.computeScoreForInsurer(insurerId, period, actorUserId),
        ),
      );
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') {
          insurersComputed += 1;
        } else {
          insurersFailed += 1;
          this.logger.error(
            `Insurer performance compute for insurer ${chunk[index]}, period ${period.periodLabel} failed: ${(result.reason as Error).message} — continuing; next run will retry.`,
          );
        }
      }
    }

    this.logger.log(
      `Insurer performance compute (${period.periodLabel}): ${insurersComputed} insurer(s) scored, ${insurersFailed} failed.`,
    );
    return {
      periodLabel: period.periodLabel,
      insurersComputed,
      insurersFailed,
    };
  }

  /** The core per-insurer computation — public so a manual recompute of one
   * insurer, or a unit test, can call it directly without touching every
   * insurer in the book. */
  async computeScoreForInsurer(
    insurerId: string,
    period: PeriodWindow,
    actorUserId: string,
  ): Promise<InsurerPerformanceScoreView> {
    const { periodStart, periodEnd, periodLabel } = period;

    const [
      quoteResponseScore,
      claimsServiceScore,
      priceScore,
      serviceQualityScore,
    ] = await Promise.all([
      this.computeQuoteResponseScore(insurerId, periodStart, periodEnd),
      this.computeClaimsServiceScore(insurerId, periodStart, periodEnd),
      this.computePriceScore(insurerId, periodStart, periodEnd),
      this.computeServiceQualityScore(insurerId, periodStart, periodEnd),
    ]);

    const { row, wasCreated } = await this.repo.upsertScore(
      insurerId,
      periodLabel,
      {
        quoteResponseScore,
        claimsServiceScore,
        priceScore,
        serviceQualityScore,
      },
    );

    await this.safeAudit({
      userId: actorUserId,
      action: wasCreated ? 'CREATE' : 'UPDATE',
      entityType: 'InsurerPerformanceScore',
      entityId: row.id,
      afterValue: insurerPerformanceAuditSnapshot(row),
    });

    return deriveInsurerPerformanceScoreView(row);
  }

  async list(
    query: ListInsurerPerformanceQueryDto,
  ): Promise<InsurerPerformanceScoreView[]> {
    const rows = await this.repo.findMany({
      insurerId: query.insurerId,
      periodLabel: query.periodLabel,
    });
    return rows.map(deriveInsurerPerformanceScoreView);
  }

  async latest(insurerId: string): Promise<InsurerPerformanceScoreView> {
    const row = await this.repo.findLatest(insurerId);
    if (!row) {
      throw new NotFoundException(
        `No performance score has been computed yet for insurer ${insurerId}.`,
      );
    }
    return deriveInsurerPerformanceScoreView(row);
  }

  private async computeQuoteResponseScore(
    insurerId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Prisma.Decimal> {
    const responded = await this.repo.findRespondedRfqInsurers(
      insurerId,
      periodStart,
      periodEnd,
    );
    if (responded.length === 0) return NEUTRAL_SCORE;

    const avgDays =
      responded.reduce(
        (sum, r) => sum + daysBetween(r.sentAt, r.respondedAt),
        0,
      ) / responded.length;
    const targetDays =
      (await this.repo.findSlaTargetDays(insurerId, 'quote_response')) ??
      DEFAULT_QUOTE_RESPONSE_TARGET_DAYS;
    return scoreFromAverageDays(avgDays, targetDays);
  }

  private async computeClaimsServiceScore(
    insurerId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Prisma.Decimal> {
    const [total, clean] = await Promise.all([
      this.repo.countClaims(insurerId, periodStart, periodEnd),
      this.repo.countClaimsWithNoFollowUpAlert(
        insurerId,
        periodStart,
        periodEnd,
      ),
    ]);
    if (total === 0) return NEUTRAL_SCORE;
    return scoreFromProportion(clean / total);
  }

  private async computePriceScore(
    insurerId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Prisma.Decimal> {
    const quotations = await this.repo.findCurrentQuotationsInWindow(
      insurerId,
      periodStart,
      periodEnd,
    );
    if (quotations.length === 0) return NEUTRAL_SCORE;

    const rfqScores: Prisma.Decimal[] = [];
    for (const q of quotations) {
      const others = await this.repo.findCompetingCurrentPremiums(
        q.rfqId,
        insurerId,
      );
      if (others.length === 0) continue; // no competing quote — not comparable
      rfqScores.push(priceCompetitivenessScore(q.premium, others));
    }
    if (rfqScores.length === 0) return NEUTRAL_SCORE;

    const sum = rfqScores.reduce(
      (acc, s) => acc.plus(s),
      new Prisma.Decimal(0),
    );
    return sum.dividedBy(rfqScores.length).toDecimalPlaces(2);
  }

  private async computeServiceQualityScore(
    insurerId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Prisma.Decimal> {
    const scores = await this.repo.findServiceScores(
      insurerId,
      periodStart,
      periodEnd,
    );
    if (scores.length === 0) return NEUTRAL_SCORE;

    // Already on a 0-100 scale (ComparisonMatrixRow.serviceScore's own
    // range, comparison.config.ts's MIN_SCORE/MAX_SCORE) — average and
    // clamp, no proportion conversion needed.
    const total = scores.reduce((sum, s) => sum + Number(s), 0);
    return clampScore(new Prisma.Decimal(total / scores.length));
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Insurer performance audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}

function insurerPerformanceAuditSnapshot(row: {
  id: string;
  insurerId: string;
  periodLabel: string;
  quoteResponseScore: Prisma.Decimal;
  claimsServiceScore: Prisma.Decimal;
  priceScore: Prisma.Decimal;
  serviceQualityScore: Prisma.Decimal;
}): Prisma.InputJsonObject {
  return {
    insurerPerformanceScoreId: row.id,
    insurerId: row.insurerId,
    periodLabel: row.periodLabel,
    quoteResponseScore: row.quoteResponseScore.toFixed(2),
    claimsServiceScore: row.claimsServiceScore.toFixed(2),
    priceScore: row.priceScore.toFixed(2),
    serviceQualityScore: row.serviceQualityScore.toFixed(2),
  };
}
