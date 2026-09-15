import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClaimService, type ClaimFollowUpScanResult } from './claim.service';
import { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';

/**
 * Process 27 — "Automated alert job once the insurer non-response threshold is
 * exceeded (configurable per line)". Runs at 07:00 UTC daily, after the 06:00
 * RFQ follow-up sweep.
 *
 * `ClaimService.runFollowUpScan` raises a `ClaimFollowUpAlert` on every
 * pre-verdict claim whose business-day `followUpAlertThresholdDays` has
 * elapsed since it was `REGISTERED` with the insurer and which has no open
 * alert, and auto-resolves alerts whose claim has since progressed past the
 * pre-verdict stage. Idempotent: the partial `UNIQUE ("claimId") WHERE
 * "resolvedAt" IS NULL` (migration `20260902190000`) means a re-run / a
 * concurrent sweep raises nothing new, and the resolve is a conditional
 * `updateMany`.
 */
@Injectable()
export class ClaimFollowUpScheduler {
  private readonly logger = new Logger(ClaimFollowUpScheduler.name);

  constructor(
    private readonly claims: ClaimService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  // 07:00 UTC daily.
  @Cron('0 7 * * *', { name: 'claim-followup-alert-sweep' })
  async runSweep(): Promise<void> {
    await this.perOrganization.forEach(
      'Claim follow-up sweep',
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
    let result: ClaimFollowUpScanResult;
    try {
      result = await this.claims.runFollowUpScan(systemUserId);
    } catch (err) {
      this.logger.error(
        `Claim follow-up sweep could not run: ${(err as Error).message}`,
      );
      return;
    }

    if (result.raised > 0 || result.autoResolved > 0 || result.failed > 0) {
      this.logger.log(
        `Claim follow-up sweep: scanned ${result.awaiting} pre-verdict claim(s), ${result.due} past threshold, ${result.raised} newly alerted, ${result.skippedAlreadyAlerted} already alerted, ${result.autoResolved} auto-resolved, ${result.failed} failed.`,
      );
    }
  }
}
