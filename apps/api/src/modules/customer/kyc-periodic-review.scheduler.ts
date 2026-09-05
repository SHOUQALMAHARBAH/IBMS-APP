import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { KYCRecord } from '@ibms/db';
import { KycRecordRepository } from '../../repositories/kyc-record.repository';
import { UserRepository } from '../../repositories/user.repository';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';

const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

/** Process 3-4 — "Schedule periodic re-KYC by risk classification
 * (KYCRecord.nextReviewDueAt)". Daily sweep transitions every APPROVED
 * KYCRecord whose review date has passed to PERIODIC_REVIEW_DUE — terminal
 * for that row (same shape as Lead's CONVERTED_TO_PROSPECT); a Sales
 * Officer starts a fresh KYCRecord for the same Customer to actually run
 * the re-KYC cycle (KycService.start() already allows a new one once the
 * prior row reaches a terminal status). */
@Injectable()
export class KycPeriodicReviewScheduler {
  private readonly logger = new Logger(KycPeriodicReviewScheduler.name);

  constructor(
    private readonly kycRecords: KycRecordRepository,
    private readonly users: UserRepository,
    private readonly workflow: WorkflowTransitionService,
  ) {}

  // 03:00 UTC daily.
  @Cron('0 3 * * *', { name: 'kyc-periodic-review-sweep' })
  async runSweep(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `KYC periodic-review sweep skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    let due: KYCRecord[];
    try {
      due = await this.kycRecords.findApprovedDueForReview(new Date());
    } catch (err) {
      this.logger.error(
        `KYC periodic-review sweep could not load due records: ${(err as Error).message}`,
      );
      return;
    }

    // Per-record isolation: one record that throws (a concurrent
    // modification, an audit-write hiccup) must not abandon the rest of the
    // sweep until tomorrow — log it and move on; the next run retries it.
    let moved = 0;
    let failed = 0;
    for (const kyc of due) {
      try {
        await this.workflow.transition({
          entityType: 'KYCRecord',
          entityId: kyc.id,
          toStatus: 'PERIODIC_REVIEW_DUE',
          actorUserId: systemUser.id,
        });
        moved += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(
          `KYC periodic-review sweep: KYCRecord ${kyc.id} failed (${(err as Error).message}) — continuing; next run will retry.`,
        );
      }
    }
    if (moved > 0 || failed > 0) {
      this.logger.log(
        `KYC periodic-review sweep: moved ${moved} KYCRecord(s) to PERIODIC_REVIEW_DUE, ${failed} failed.`,
      );
    }
  }
}
