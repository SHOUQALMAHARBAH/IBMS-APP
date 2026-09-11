import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RenewalService } from './renewal.service';
import { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';

/**
 * Part 3.9 — "triggered automatically at a configurable lead time before
 * expiry (default 90 days)" (`RenewalCase`'s own schema comment).
 *
 * Runs at 05:00 UTC daily — after the 04:00 cross-sell sweep and before the
 * 06:00 RFQ follow-up and 07:00 claim follow-up sweeps, so a renewal case
 * exists before the retention sweep that reads it looks for one.
 *
 * Idempotent: `RenewalCase.policyId @unique` means a re-run opens nothing
 * new, and `RenewalService.openCase` counts the `P2002` as a skip rather
 * than a failure.
 */
@Injectable()
export class RenewalScheduler {
  private readonly logger = new Logger(RenewalScheduler.name);

  constructor(
    private readonly renewal: RenewalService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  @Cron('0 5 * * *', { name: 'renewal-lead-time-sweep' })
  async runSweep(): Promise<void> {
    await this.perOrganization.forEach(
      'Renewal lead-time sweep',
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
    try {
      await this.renewal.runSweep(systemUserId);
    } catch (err) {
      this.logger.error(
        `Renewal lead-time sweep failed: ${(err as Error).message}`,
      );
    }
  }
}
