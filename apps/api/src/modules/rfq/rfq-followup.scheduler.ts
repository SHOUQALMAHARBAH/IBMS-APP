import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RfqService, type FollowUpScanResult } from './rfq.service';
import { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';

/**
 * Process 11 — "Follow-up alert job once `followUpThresholdDays` is
 * exceeded" + Process 12 (Market Placement) auto-NO_RESPONSE. Runs at 06:00
 * UTC daily, after the 04:00 cross-sell and 05:00 up-sell sweeps.
 *
 * `RfqService.runFollowUpScan` finds every still-open `RFQInsurer` (status
 * SENT / VIEWED) whose RFQ's business-day `followUpThresholdDays` has elapsed
 * since `sentAt`, stamps `followUpAlertSentAt` + writes an audit row, and
 * moves it SENT/VIEWED -> NO_RESPONSE through the workflow engine (a late
 * responder can still be moved NO_RESPONSE -> QUOTED/DECLINED). A submission
 * whose insurer already has a current `Quotation` (backlog Part C #13) is
 * dropped first — it responded, whatever its status column says. Idempotent:
 * `stampFollowUpAlert` is conditional on the timestamp still being null, and
 * once NO_RESPONSE the row is out of the candidate set; a concurrent manual
 * QUOTED/DECLINED makes the transition a safe no-op.
 */
@Injectable()
export class RfqFollowUpScheduler {
  private readonly logger = new Logger(RfqFollowUpScheduler.name);

  constructor(
    private readonly rfqs: RfqService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  // 06:00 UTC daily.
  @Cron('0 6 * * *', { name: 'rfq-followup-alert-sweep' })
  async runSweep(): Promise<void> {
    await this.perOrganization.forEach(
      'RFQ follow-up sweep',
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
    let result: FollowUpScanResult;
    try {
      result = await this.rfqs.runFollowUpScan(systemUserId);
    } catch (err) {
      this.logger.error(
        `RFQ follow-up sweep could not run: ${(err as Error).message}`,
      );
      return;
    }

    if (
      result.alerted > 0 ||
      result.autoNoResponse > 0 ||
      result.transitionSkipped > 0 ||
      result.skippedQuoted > 0 ||
      result.failed > 0
    ) {
      this.logger.log(
        `RFQ follow-up sweep: ${result.candidates} open submission(s) awaiting a response, ${result.due} past threshold, ${result.alerted} newly alerted, ${result.autoNoResponse} moved to NO_RESPONSE, ${result.transitionSkipped} skipped (insurer responded), ${result.skippedQuoted} skipped (already quoted), ${result.failed} failed.`,
      );
    }
  }
}
