import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmployeePerformanceService } from './employee-performance.service';
import { previousUtcMonthRange } from './employee-performance.config';
import { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';

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
    private readonly performance: EmployeePerformanceService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  // 07:00 UTC on the 1st of every month.
  @Cron('0 7 1 * *', { name: 'employee-performance-monthly' })
  async runMonthlyCompute(): Promise<void> {
    await this.perOrganization.forEach(
      'Employee-performance scoring sweep',
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
      await this.performance.computeRecords(period, systemUserId);
    } catch (err) {
      this.logger.error(
        `Employee performance monthly compute (${period.periodLabel}) failed: ${(err as Error).message}`,
      );
    }
  }
}
