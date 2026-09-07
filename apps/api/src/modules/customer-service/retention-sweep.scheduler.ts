import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRepository } from '../../repositories/user.repository';
import {
  RetentionCaseService,
  type RetentionSweepResult,
} from './retention-case.service';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as the other schedulers.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

/**
 * Process 46 — "Automatically open a retention case on renewal inactivity or
 * lapse risk" (backlog Part C #46's one checkbox). Runs at 08:00 UTC daily,
 * after the 07:00 claim follow-up sweep. Delegates to
 * `RetentionCaseService.runSweep`, which is idempotent: the
 * `RenewalCase.retentionEscalatedAt` conditional stamp means a re-run adds
 * nothing.
 *
 * **Built ahead of its data source** (the #8 / #10 / #29 shape): the
 * `RenewalCase` model (Part 3.9) exists in the schema, but the renewal
 * module that would create one per policy approaching expiry is not built
 * yet, so in normal running `findRenewalCasesForSweep()` returns an empty
 * set and this sweep is a logged no-op. It exercises for real the moment a
 * `RenewalCase` exists (today, only e2e tests create one directly).
 */
@Injectable()
export class RetentionSweepScheduler {
  private readonly logger = new Logger(RetentionSweepScheduler.name);

  constructor(
    private readonly users: UserRepository,
    private readonly retentionCases: RetentionCaseService,
  ) {}

  // 08:00 UTC daily.
  @Cron('0 8 * * *', { name: 'retention-case-detection-sweep' })
  async runSweep(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `Retention-case sweep skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    let result: RetentionSweepResult;
    try {
      result = await this.retentionCases.runSweep(systemUser.id);
    } catch (err) {
      this.logger.error(
        `Retention-case sweep failed: ${(err as Error).message}`,
      );
      return;
    }

    if (
      result.openedRenewalInactivity > 0 ||
      result.openedLapseRisk > 0 ||
      result.failed > 0
    ) {
      this.logger.log(
        `Retention-case sweep: scanned ${result.scanned} renewal case(s), opened ${result.openedRenewalInactivity} for inactivity + ${result.openedLapseRisk} for lapse risk, ${result.failed} failed.`,
      );
    }
  }
}
