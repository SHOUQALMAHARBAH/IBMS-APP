import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRepository } from '../../repositories/user.repository';
import { InternalControlsService } from './internal-controls.service';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as the other schedulers.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

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
    private readonly users: UserRepository,
    private readonly internalControls: InternalControlsService,
  ) {}

  // Daily at 10:00 UTC.
  @Cron('0 10 * * *', { name: 'internal-controls-self-approval-audit' })
  async runAudit(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `Internal controls audit skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    try {
      await this.internalControls.runScheduledAudit(systemUser.id);
    } catch (err) {
      this.logger.error(
        `Internal controls audit failed: ${(err as Error).message}`,
      );
    }
  }
}
