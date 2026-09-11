import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AccessRecertificationService } from './access-recertification.service';
import { PerOrganizationRunner } from '../../../common/org-context/per-organization.runner';
import { addBusinessDays } from '../../../common/business-days.util';

const CYCLE_SLA_BUSINESS_DAYS = 15; // Part A.8 — "quarterly access review (15 business days)"

/** Part 10.1 — fires the quarterly access-recertification cycle
 * automatically. See access-recertification.controller.ts for the
 * manual-trigger endpoint used for ops/testing between real firings. */
@Injectable()
export class AccessRecertificationScheduler {
  private readonly logger = new Logger(AccessRecertificationScheduler.name);

  constructor(
    private readonly recertification: AccessRecertificationService,
    private readonly perOrganization: PerOrganizationRunner,
  ) {}

  // 00:00 on day-of-month 1 in January, April, July, October.
  @Cron('0 0 1 1,4,7,10 *', { name: 'quarterly-access-recertification' })
  async runQuarterlyCycle(): Promise<void> {
    await this.perOrganization.forEach(
      'Quarterly access-recertification cycle',
      this.logger,
      (systemUserId) => this.startCycleForOrganization(systemUserId),
    );
  }

  /**
   * One Organization's recertification cycle. Multi-tenancy Phase 2 (step 7):
   * each office recertifies its OWN people's access on its own cycle row — a
   * single platform-wide cycle would have put one office's reviewers in front
   * of another office's grants.
   */
  private async startCycleForOrganization(systemUserId: string): Promise<void> {
    const now = new Date();
    const label = `Q${Math.floor(now.getUTCMonth() / 3) + 1}-${now.getUTCFullYear()}`;
    const dueAt = addBusinessDays(now, CYCLE_SLA_BUSINESS_DAYS);
    try {
      const cycle = await this.recertification.startCycle(
        label,
        dueAt,
        systemUserId,
      );
      this.logger.log(
        `Started scheduled access-recertification cycle ${cycle.id} (${label})`,
      );
    } catch (err) {
      // Never let a scheduled job crash the process — surface loudly and
      // let ops start the cycle manually via the admin endpoint instead.
      this.logger.error(
        `Scheduled access-recertification cycle failed to start: ${(err as Error).message}`,
      );
    }
  }
}
