import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CrossSellOpportunityRepository } from '../../repositories/cross-sell-opportunity.repository';
import { CrossSellService } from './cross-sell.service';
import { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';

/**
 * Process 8 — "Automated job comparing a customer's active policies against
 * a benchmark line list and flagging the gap". Daily is a reasonable cadence
 * for a cross-sell nudge (a new gap opens only when a policy incepts or
 * lapses); it runs at 04:00 UTC, after the 02:00 screening batch and 03:00
 * KYC review sweep.
 *
 * Scans every customer that holds at least one in-force policy (a customer
 * with no cover is a new-business prospect, not a cross-sell target) and
 * lets CrossSellService.runDetection flag the benchmark lines they have no
 * cover for. Idempotent: the `@@unique([customerId, gapLine])` +
 * `createMany({ skipDuplicates })` mean a re-run adds nothing.
 *
 * The Policy module (Domain B) is not built, so `findCustomerIdsWithInForcePolicy`
 * returns an empty set in every environment today and this sweep is a no-op
 * — built ahead of its data source, same pattern as the A.8 SLA registry's
 * 13 unwired timer types (README § Known gaps, Part C #8).
 */
@Injectable()
export class CrossSellDetectionScheduler {
  private readonly logger = new Logger(CrossSellDetectionScheduler.name);

  constructor(
    private readonly opportunities: CrossSellOpportunityRepository,
    private readonly crossSell: CrossSellService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  // 04:00 UTC daily.
  @Cron('0 4 * * *', { name: 'cross-sell-gap-detection-sweep' })
  async runSweep(): Promise<void> {
    await this.perOrganization.forEach(
      'Cross-sell gap-detection sweep',
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
    let customerIds: string[];
    try {
      customerIds = await this.opportunities.findCustomerIdsWithInForcePolicy();
    } catch (err) {
      this.logger.error(
        `Cross-sell gap-detection sweep could not load customers: ${(err as Error).message}`,
      );
      return;
    }

    // Per-customer isolation: one customer that throws (a concurrent
    // modification, an audit-write hiccup) must not abandon the rest of the
    // sweep until tomorrow — log it and move on; the next run retries it.
    let flagged = 0;
    let customersWithNewGaps = 0;
    let failed = 0;
    for (const customerId of customerIds) {
      try {
        const { newlyFlagged } = await this.crossSell.runDetection(
          customerId,
          systemUserId,
        );
        if (newlyFlagged.length > 0) {
          customersWithNewGaps += 1;
          flagged += newlyFlagged.length;
        }
      } catch (err) {
        failed += 1;
        this.logger.error(
          `Cross-sell gap-detection sweep: customer ${customerId} failed (${(err as Error).message}) — continuing; next run will retry.`,
        );
      }
    }

    if (flagged > 0 || failed > 0) {
      this.logger.log(
        `Cross-sell gap-detection sweep: scanned ${customerIds.length} customer(s) with in-force cover, flagged ${flagged} new gap(s) across ${customersWithNewGaps} customer(s), ${failed} failed.`,
      );
    }
  }
}
