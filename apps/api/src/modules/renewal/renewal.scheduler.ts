import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRepository } from '../../repositories/user.repository';
import { RenewalService } from './renewal.service';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as CrossSellDetectionScheduler / ClaimFollowUpScheduler /
// AccessRecertificationScheduler.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

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
    private readonly users: UserRepository,
    private readonly renewal: RenewalService,
  ) {}

  @Cron('0 5 * * *', { name: 'renewal-lead-time-sweep' })
  async runSweep(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `Renewal lead-time sweep skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    try {
      await this.renewal.runSweep(systemUser.id);
    } catch (err) {
      this.logger.error(
        `Renewal lead-time sweep failed: ${(err as Error).message}`,
      );
    }
  }
}
