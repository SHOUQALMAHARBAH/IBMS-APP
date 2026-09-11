import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InsurerPerformanceService } from './insurer-performance.service';
import { previousUtcMonthRange } from './insurer-performance.config';
import { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';

/**
 * Process 60 — "a periodic job computing the score from quote-response
 * speed/claims service/price/service quality." Monthly, not daily/nightly
 * like every other sweep in this codebase — an insurer's performance over a
 * handful of hours is meaningless noise; scoring the UTC calendar month
 * that JUST ended is the natural cadence. Runs at 06:00 UTC on the 1st,
 * clear of the 02:00-05:00 daily sweeps (screening, KYC review, cross-sell,
 * up-sell) this codebase already runs.
 */
@Injectable()
export class InsurerPerformanceScheduler {
  private readonly logger = new Logger(InsurerPerformanceScheduler.name);

  constructor(
    private readonly performance: InsurerPerformanceService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  // 06:00 UTC on the 1st of every month.
  @Cron('0 6 1 * *', { name: 'insurer-performance-monthly' })
  async runMonthlyCompute(): Promise<void> {
    await this.perOrganization.forEach(
      'Insurer-performance scoring sweep',
      this.logger,
      (systemUserId) => this.computeForOrganization(systemUserId),
    );
  }

  /**
   * One Organization's slice of this sweep. Multi-tenancy Phase 2 (step 7):
   * every query below is filtered to the Organization `forEach` established,
   * and `systemUserId` is THAT office's own service account — not a single
   * platform-wide one.
   */
  private async computeForOrganization(systemUserId: string): Promise<void> {
    const period = previousUtcMonthRange(new Date());
    try {
      await this.performance.computeScores(period, systemUserId);
    } catch (err) {
      this.logger.error(
        `Insurer performance monthly compute (${period.periodLabel}) failed: ${(err as Error).message}`,
      );
    }
  }
}
