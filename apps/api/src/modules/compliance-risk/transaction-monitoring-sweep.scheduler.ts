import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  TransactionMonitoringService,
  type TransactionMonitoringSweepResult,
} from './transaction-monitoring.service';
import { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';

/**
 * Process 48 — "Monitor unusual patterns" (backlog Part C #48's first
 * checkbox). Runs at 09:00 UTC daily, after the 08:00 retention-case sweep.
 * Delegates to `TransactionMonitoringService.runSweep`, which is idempotent:
 * the per-Receipt unique index and the per-customer partial-unique index
 * mean a re-run adds nothing already flagged.
 */
@Injectable()
export class TransactionMonitoringSweepScheduler {
  private readonly logger = new Logger(
    TransactionMonitoringSweepScheduler.name,
  );

  constructor(
    private readonly monitoring: TransactionMonitoringService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  // 09:00 UTC daily.
  @Cron('0 9 * * *', { name: 'transaction-monitoring-sweep' })
  async runSweep(): Promise<void> {
    await this.perOrganization.forEach(
      'Transaction-monitoring sweep',
      this.logger,
      (systemUserId) => this.sweepOrganization(systemUserId),
    );
  }

  /**
   * One Organization's slice of this sweep. Multi-tenancy Phase 2 (step 7):
   * every query below is filtered to the Organization `forEach` established,
   * and `systemUserId` is THAT office's own service account — not a single
   * platform-wide one.
   */
  private async sweepOrganization(systemUserId: string): Promise<void> {
    let result: TransactionMonitoringSweepResult;
    try {
      result = await this.monitoring.runSweep(systemUserId);
    } catch (err) {
      this.logger.error(
        `Transaction-monitoring sweep failed: ${(err as Error).message}`,
      );
      return;
    }

    if (result.created > 0 || result.failed > 0) {
      this.logger.log(
        `Transaction-monitoring sweep: scanned ${result.scanned} candidate(s), created ${result.created} alert(s), skipped ${result.skippedExisting} already-flagged, ${result.failed} failed.`,
      );
    }
  }
}
