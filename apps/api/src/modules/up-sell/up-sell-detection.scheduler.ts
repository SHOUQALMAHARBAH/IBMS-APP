import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import { UserRepository } from '../../repositories/user.repository';
import { UpSellService } from './up-sell.service';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as the other schedulers.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

/**
 * Process 9 — "Automated job comparing current Sum Insured against updated
 * asset value and proposing an increase". Daily is a reasonable cadence for
 * an under-insurance nudge (a gap only opens when assets are revalued or
 * added); it runs at 05:00 UTC, after the 02:00 screening batch, 03:00 KYC
 * review sweep, and 04:00 cross-sell sweep.
 *
 * Scans every customer that has at least one non-SUPERSEDED
 * `InsuranceProgram` (there is no "current Sum Insured" to compare against
 * otherwise) and lets `UpSellService.runDetection` flag a proposed increase
 * where the surveyed asset value has grown materially past the designed
 * property Sum Insured. Idempotent: the partial UNIQUE index
 * (`customerId WHERE status = 'OPEN'`) + the `create()` `P2002` catch +
 * the re-nag pre-check mean a re-run adds nothing.
 */
@Injectable()
export class UpSellDetectionScheduler {
  private readonly logger = new Logger(UpSellDetectionScheduler.name);

  constructor(
    private readonly insurancePrograms: InsuranceProgramRepository,
    private readonly users: UserRepository,
    private readonly upSell: UpSellService,
  ) {}

  // 05:00 UTC daily.
  @Cron('0 5 * * *', { name: 'up-sell-underinsurance-sweep' })
  async runSweep(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `Up-sell under-insurance sweep skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    let customerIds: string[];
    try {
      customerIds =
        await this.insurancePrograms.findCustomerIdsWithLiveProgram();
    } catch (err) {
      this.logger.error(
        `Up-sell under-insurance sweep could not load customers: ${(err as Error).message}`,
      );
      return;
    }

    // Per-customer isolation: one customer that throws (a concurrent
    // modification, an audit-write hiccup) must not abandon the rest of the
    // sweep until tomorrow — log it and move on; the next run retries it.
    let flagged = 0;
    let suppressed = 0;
    let failed = 0;
    for (const customerId of customerIds) {
      try {
        const outcome = await this.upSell.runDetection(
          customerId,
          systemUser.id,
        );
        if (outcome.flagged) flagged += 1;
        else if (outcome.suppressedByPriorResolution) suppressed += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(
          `Up-sell under-insurance sweep: customer ${customerId} failed (${(err as Error).message}) — continuing; next run will retry.`,
        );
      }
    }

    if (flagged > 0 || failed > 0) {
      this.logger.log(
        `Up-sell under-insurance sweep: scanned ${customerIds.length} customer(s) with a live programme, flagged ${flagged}, suppressed ${suppressed} (already resolved at this asset level), ${failed} failed.`,
      );
    }
  }
}
