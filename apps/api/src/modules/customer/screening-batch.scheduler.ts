import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ScreeningService,
  type ScreeningBatchResult,
} from './screening.service';
import { SANCTIONS_RESCREEN_CRON } from '../compliance-risk/watchlist-sync.config';
import { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';

/** Process 3-4 / 49 — "Run sanctions/PEP/AML screening ... on a recurring
 * batch" (backlog Part C #3-4) / "a recurring batch against updated lists"
 * (backlog Part C #49). Every 4 hours — the lists themselves (Process 49's
 * OFAC SDN / UN Consolidated sync) refresh roughly every 12 hours; checking
 * more often than that finds nothing new, checking this much less often
 * would let a name added mid-cycle sit unscreened for too long. Replaces
 * the drafted monthly cadence this scheduler shipped with before a real
 * list-refresh cadence was known (see README § Known gaps, Part C #3-4 /
 * #49). Delegates the actual customer-selection + per-customer re-screen
 * logic to `ScreeningService.runRecurringBatch` — shared with the on-demand
 * `POST /screening/recurring-batch` (`sanctions-pep.screen`). */
@Injectable()
export class ScreeningBatchScheduler {
  private readonly logger = new Logger(ScreeningBatchScheduler.name);

  constructor(
    private readonly screening: ScreeningService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  @Cron(SANCTIONS_RESCREEN_CRON, { name: 'recurring-screening-batch' })
  async runBatch(): Promise<void> {
    await this.perOrganization.forEach(
      'Screening re-screen batch',
      this.logger,
      (systemUserId) => this.runBatchForOrganization(systemUserId),
    );
  }

  /**
   * One Organization's slice of this sweep. Multi-tenancy Phase 2 (step 7):
   * every query below is filtered to the Organization `forEach` established,
   * and `systemUserId` is THAT office's own service account — not a single
   * platform-wide one.
   */
  private async runBatchForOrganization(systemUserId: string): Promise<void> {
    let result: ScreeningBatchResult;
    try {
      result = await this.screening.runRecurringBatch(systemUserId);
    } catch (err) {
      this.logger.error(
        `Recurring screening batch could not run: ${(err as Error).message}`,
      );
      return;
    }
    this.logger.log(
      `Recurring screening batch: re-screened ${result.screened} active customer(s), ${result.hits} produced a HIT, ${result.failed} failed.`,
    );
  }
}
