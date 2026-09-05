import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRepository } from '../../repositories/user.repository';
import { InsurerPerformanceService } from './insurer-performance.service';
import { previousUtcMonthRange } from './insurer-performance.config';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as the other schedulers (e.g. UpSellDetectionScheduler).
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

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
    private readonly users: UserRepository,
    private readonly performance: InsurerPerformanceService,
  ) {}

  // 06:00 UTC on the 1st of every month.
  @Cron('0 6 1 * *', { name: 'insurer-performance-monthly' })
  async runMonthlyCompute(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `Insurer performance monthly compute skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    const period = previousUtcMonthRange(new Date());
    try {
      await this.performance.computeScores(period, systemUser.id);
    } catch (err) {
      this.logger.error(
        `Insurer performance monthly compute (${period.periodLabel}) failed: ${(err as Error).message}`,
      );
    }
  }
}
