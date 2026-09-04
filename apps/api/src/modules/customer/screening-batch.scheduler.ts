import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRepository } from '../../repositories/user.repository';
import {
  ScreeningService,
  type ScreeningBatchResult,
} from './screening.service';
import { SANCTIONS_RESCREEN_CRON } from '../compliance-risk/watchlist-sync.config';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as SlaTimerService/AccessRecertificationScheduler.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

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
    private readonly users: UserRepository,
    private readonly screening: ScreeningService,
  ) {}

  @Cron(SANCTIONS_RESCREEN_CRON, { name: 'recurring-screening-batch' })
  async runBatch(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `Recurring screening batch skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    let result: ScreeningBatchResult;
    try {
      result = await this.screening.runRecurringBatch(systemUser.id);
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
