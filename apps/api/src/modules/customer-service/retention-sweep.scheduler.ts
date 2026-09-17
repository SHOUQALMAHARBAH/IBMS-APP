import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  RetentionCaseService,
  type RetentionSweepResult,
} from './retention-case.service';
import { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';

/**
 * Process 46 — "Automatically open a retention case on renewal inactivity or
 * lapse risk" (backlog Part C #46's one checkbox). Runs at 08:00 UTC daily,
 * after the 07:00 claim follow-up sweep. Delegates to
 * `RetentionCaseService.runSweep`, which is idempotent: the
 * `RenewalCase.retentionEscalatedAt` conditional stamp means a re-run adds
 * nothing.
 *
 * **Built ahead of its data source** (the #8 / #10 / #29 shape): the
 * `RenewalCase` model (Part 3.9) exists in the schema, but the renewal
 * module that would create one per policy approaching expiry is not built
 * yet, so in normal running `findRenewalCasesForSweep()` returns an empty
 * set and this sweep is a logged no-op. It exercises for real the moment a
 * `RenewalCase` exists (today, only e2e tests create one directly).
 */
@Injectable()
export class RetentionSweepScheduler {
  private readonly logger = new Logger(RetentionSweepScheduler.name);

  constructor(
    private readonly retentionCases: RetentionCaseService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  // 08:00 UTC daily.
  @Cron('0 8 * * *', { name: 'retention-case-detection-sweep' })
  async runSweep(): Promise<void> {
    await this.perOrganization.forEach(
      'Retention-case sweep',
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
    let result: RetentionSweepResult;
    try {
      result = await this.retentionCases.runSweep(systemUserId);
    } catch (err) {
      this.logger.error(
        `Retention-case sweep failed: ${(err as Error).message}`,
      );
      return;
    }

    if (
      result.openedRenewalInactivity > 0 ||
      result.openedLapseRisk > 0 ||
      result.failed > 0
    ) {
      this.logger.log(
        `Retention-case sweep: scanned ${result.scanned} renewal case(s), opened ${result.openedRenewalInactivity} for inactivity + ${result.openedLapseRisk} for lapse risk, ${result.failed} failed.`,
      );
    }
  }
}
