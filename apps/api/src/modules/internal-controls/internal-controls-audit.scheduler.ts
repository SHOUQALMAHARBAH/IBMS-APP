import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InternalControlsService } from './internal-controls.service';
import { PerOrganizationRunner } from '../../common/org-context/per-organization.runner';

/**
 * Process 56 (backlog Part C #56) — "a periodic audit report scanning for
 * any possible self-approval cases." Runs daily at 10:00 UTC, after the
 * 09:00 transaction-monitoring sweep, delegating to the exact scan
 * `GET /internal-controls/self-approval-audit` runs on demand.
 */
@Injectable()
export class InternalControlsAuditScheduler {
  private readonly logger = new Logger(InternalControlsAuditScheduler.name);

  constructor(
    private readonly internalControls: InternalControlsService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  // Daily at 10:00 UTC.
  @Cron('0 10 * * *', { name: 'internal-controls-self-approval-audit' })
  async runAudit(): Promise<void> {
    await this.perOrganization.forEach(
      'Internal-controls audit sweep',
      this.logger,
      (systemUserId) => this.runAuditForOrganization(systemUserId),
    );
  }

  /**
   * One Organization's slice of this sweep. Multi-tenancy Phase 2 (step 7):
   * every query below is filtered to the Organization `forEach` established,
   * and `systemUserId` is THAT office's own service account — not a single
   * platform-wide one.
   */
  private async runAuditForOrganization(systemUserId: string): Promise<void> {
    try {
      await this.internalControls.runScheduledAudit(systemUserId);
    } catch (err) {
      this.logger.error(
        `Internal controls audit failed: ${(err as Error).message}`,
      );
    }
  }
}
