import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { KYCRecord } from '@ibms/db';
import { KycRecordRepository } from '../../repositories/kyc-record.repository';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';

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
    private readonly workflow: WorkflowTransitionService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  // 03:00 UTC daily.
  @Cron('0 3 * * *', { name: 'kyc-periodic-review-sweep' })
  async runSweep(): Promise<void> {
    await this.perOrganization.forEach(
      'KYC periodic-review sweep',
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
          actorUserId: systemUserId,
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
