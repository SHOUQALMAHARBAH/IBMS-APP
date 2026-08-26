import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AccessRecertificationService } from './access-recertification.service';
import { UserRepository } from '../../../repositories/user.repository';
import { addBusinessDays } from '../../../common/business-days.util';

const CYCLE_SLA_BUSINESS_DAYS = 15; // Part A.8 — "quarterly access review (15 business days)"

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL —
// AuditLogEntry.userId is a real FK to User, so a scheduled job needs a
// real (login-disabled) row to attribute its audit entries to.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

/** Part 10.1 — fires the quarterly access-recertification cycle
 * automatically. See access-recertification.controller.ts for the
 * manual-trigger endpoint used for ops/testing between real firings. */
@Injectable()
export class AccessRecertificationScheduler {
  private readonly logger = new Logger(AccessRecertificationScheduler.name);

  constructor(
    private readonly recertification: AccessRecertificationService,
    private readonly users: UserRepository,
  ) {}

  // 00:00 on day-of-month 1 in January, April, July, October.
  @Cron('0 0 1 1,4,7,10 *', { name: 'quarterly-access-recertification' })
  async runQuarterlyCycle(): Promise<void> {
    const now = new Date();
    const label = `Q${Math.floor(now.getUTCMonth() / 3) + 1}-${now.getUTCFullYear()}`;
    const dueAt = addBusinessDays(now, CYCLE_SLA_BUSINESS_DAYS);
    try {
      const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
      if (!systemUser) {
        throw new Error(
          `System service account "${SYSTEM_ACCOUNT_EMAIL}" not found — has the seed (npm run db:seed) been run?`,
        );
      }
      const cycle = await this.recertification.startCycle(
        label,
        dueAt,
        systemUser.id,
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
