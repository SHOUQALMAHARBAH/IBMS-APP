import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRepository } from '../../repositories/user.repository';
import { ClaimService, type ClaimFollowUpScanResult } from './claim.service';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as the cross-sell / up-sell / RFQ follow-up schedulers.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

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
    private readonly users: UserRepository,
    private readonly claims: ClaimService,
  ) {}

  // 07:00 UTC daily.
  @Cron('0 7 * * *', { name: 'claim-followup-alert-sweep' })
  async runSweep(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `Claim follow-up sweep skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    let result: ClaimFollowUpScanResult;
    try {
      result = await this.claims.runFollowUpScan(systemUser.id);
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
