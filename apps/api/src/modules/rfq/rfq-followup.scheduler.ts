import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRepository } from '../../repositories/user.repository';
import { RfqService, type FollowUpScanResult } from './rfq.service';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as the cross-sell / up-sell schedulers.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

/**
 * Process 11 — "Follow-up alert job once `followUpThresholdDays` is
 * exceeded". Runs at 06:00 UTC daily, after the 04:00 cross-sell and 05:00
 * up-sell sweeps.
 *
 * `RfqService.runFollowUpScan` finds every still-open `RFQInsurer` (status
 * SENT / VIEWED, not yet alerted) whose RFQ's business-day
 * `followUpThresholdDays` has elapsed since `sentAt`, stamps
 * `followUpAlertSentAt`, and writes an audit row. **Alert only** — it does
 * not move a silent insurer to NO_RESPONSE; that is a human decision in
 * Process 12 (Market Placement). Idempotent: `stampFollowUpAlert` is
 * conditional on the timestamp still being null, so a re-run adds nothing.
 */
@Injectable()
export class RfqFollowUpScheduler {
  private readonly logger = new Logger(RfqFollowUpScheduler.name);

  constructor(
    private readonly users: UserRepository,
    private readonly rfqs: RfqService,
  ) {}

  // 06:00 UTC daily.
  @Cron('0 6 * * *', { name: 'rfq-followup-alert-sweep' })
  async runSweep(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `RFQ follow-up sweep skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    let result: FollowUpScanResult;
    try {
      result = await this.rfqs.runFollowUpScan(systemUser.id);
    } catch (err) {
      this.logger.error(
        `RFQ follow-up sweep could not run: ${(err as Error).message}`,
      );
      return;
    }

    if (result.alerted > 0 || result.failed > 0) {
      this.logger.log(
        `RFQ follow-up sweep: ${result.candidates} open submission(s) awaiting a response, ${result.due} past threshold, ${result.alerted} newly alerted, ${result.failed} failed.`,
      );
    }
  }
}
