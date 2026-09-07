import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CrossSellOpportunityRepository } from '../../repositories/cross-sell-opportunity.repository';
import { UserRepository } from '../../repositories/user.repository';
import { CrossSellService } from './cross-sell.service';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as ScreeningBatchScheduler / KycPeriodicReviewScheduler /
// AccessRecertificationScheduler.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

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
    private readonly users: UserRepository,
    private readonly crossSell: CrossSellService,
  ) {}

  // 04:00 UTC daily.
  @Cron('0 4 * * *', { name: 'cross-sell-gap-detection-sweep' })
  async runSweep(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `Cross-sell gap-detection sweep skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

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
          systemUser.id,
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
