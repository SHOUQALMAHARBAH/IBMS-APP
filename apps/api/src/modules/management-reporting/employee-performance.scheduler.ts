import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRepository } from '../../repositories/user.repository';
import { EmployeePerformanceService } from './employee-performance.service';
import { previousUtcMonthRange } from './employee-performance.config';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as the other schedulers.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

/**
 * Process 61 — "a periodic job: new clients/premium/commission/renewal
 * rate/cross-sell rate." Monthly, the same cadence #60 established for a
 * performance snapshot — scoring an employee's book over a few hours would
 * be meaningless noise. Runs at 07:00 UTC on the 1st, clear of #60's 06:00
 * slot and the 02:00-05:00 daily sweeps.
 */
@Injectable()
export class EmployeePerformanceScheduler {
  private readonly logger = new Logger(EmployeePerformanceScheduler.name);

  constructor(
    private readonly users: UserRepository,
    private readonly performance: EmployeePerformanceService,
  ) {}

  // 07:00 UTC on the 1st of every month.
  @Cron('0 7 1 * *', { name: 'employee-performance-monthly' })
  async runMonthlyCompute(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `Employee performance monthly compute skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    const period = previousUtcMonthRange(new Date());
    try {
      await this.performance.computeRecords(period, systemUser.id);
    } catch (err) {
      this.logger.error(
        `Employee performance monthly compute (${period.periodLabel}) failed: ${(err as Error).message}`,
      );
    }
  }
}
