import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRepository } from '../../repositories/user.repository';
import {
  TransactionMonitoringService,
  type TransactionMonitoringSweepResult,
} from './transaction-monitoring.service';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as the other schedulers.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

/**
 * Process 48 — "Monitor unusual patterns" (backlog Part C #48's first
 * checkbox). Runs at 09:00 UTC daily, after the 08:00 retention-case sweep.
 * Delegates to `TransactionMonitoringService.runSweep`, which is idempotent:
 * the per-Receipt unique index and the per-customer partial-unique index
 * mean a re-run adds nothing already flagged.
 */
@Injectable()
export class TransactionMonitoringSweepScheduler {
  private readonly logger = new Logger(
    TransactionMonitoringSweepScheduler.name,
  );

  constructor(
    private readonly users: UserRepository,
    private readonly monitoring: TransactionMonitoringService,
  ) {}

  // 09:00 UTC daily.
  @Cron('0 9 * * *', { name: 'transaction-monitoring-sweep' })
  async runSweep(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `Transaction-monitoring sweep skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    let result: TransactionMonitoringSweepResult;
    try {
      result = await this.monitoring.runSweep(systemUser.id);
    } catch (err) {
      this.logger.error(
        `Transaction-monitoring sweep failed: ${(err as Error).message}`,
      );
      return;
    }

    if (result.created > 0 || result.failed > 0) {
      this.logger.log(
        `Transaction-monitoring sweep: scanned ${result.scanned} candidate(s), created ${result.created} alert(s), skipped ${result.skippedExisting} already-flagged, ${result.failed} failed.`,
      );
    }
  }
}
