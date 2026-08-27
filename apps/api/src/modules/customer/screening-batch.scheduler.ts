import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Customer } from '@ibms/db';
import { CustomerRepository } from '../../repositories/customer.repository';
import { KycRecordRepository } from '../../repositories/kyc-record.repository';
import { UserRepository } from '../../repositories/user.repository';
import { ScreeningService } from './screening.service';

// Kept in sync with packages/db/prisma/seed.ts's SYSTEM_ACCOUNT_EMAIL — same
// convention as SlaTimerService/AccessRecertificationScheduler.
const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

/** Process 3-4 — "Run sanctions/PEP/AML screening ... on a recurring
 * batch". Monthly is a reasonable cadence for a recurring AML sweep absent
 * any sourced figure (same drafted-default caveat as the KYC/EDD SLA
 * durations — see README § Known gaps, Part C #3-4); re-screens every ACTIVE
 * customer whose latest KYCRecord is APPROVED *or* PERIODIC_REVIEW_DUE —
 * PERIODIC_REVIEW_DUE is an ACTIVE customer awaiting re-KYC (the periodic
 * scheduler flags it, nothing suspends the Customer), i.e. the slice whose
 * ongoing screening most needs to keep running, not be dropped until a
 * fresh KYC file is approved. Never changes the KYC status (see
 * KycService.rerunScreening's own comment for why a batch-surfaced HIT
 * doesn't force a transition on its own). */
@Injectable()
export class ScreeningBatchScheduler {
  private readonly logger = new Logger(ScreeningBatchScheduler.name);

  constructor(
    private readonly customers: CustomerRepository,
    private readonly kycRecords: KycRecordRepository,
    private readonly users: UserRepository,
    private readonly screening: ScreeningService,
  ) {}

  // 02:00 UTC on the 1st of every month.
  @Cron('0 2 1 * *', { name: 'recurring-screening-batch' })
  async runBatch(): Promise<void> {
    const systemUser = await this.users.findByEmail(SYSTEM_ACCOUNT_EMAIL);
    if (!systemUser) {
      this.logger.error(
        `Recurring screening batch skipped — system service account "${SYSTEM_ACCOUNT_EMAIL}" not found (has npm run db:seed been run?)`,
      );
      return;
    }

    let activeCustomers: Customer[];
    try {
      activeCustomers = await this.customers.findActive();
    } catch (err) {
      this.logger.error(
        `Recurring screening batch could not load active customers: ${(err as Error).message}`,
      );
      return;
    }

    // Per-customer isolation: one customer's screening failure must not
    // abandon the rest of the batch until next month — log it and move on.
    let screened = 0;
    let hits = 0;
    let failed = 0;
    for (const customer of activeCustomers) {
      try {
        const kyc = await this.kycRecords.findLatestByCustomerId(customer.id);
        if (
          !kyc ||
          (kyc.status !== 'APPROVED' && kyc.status !== 'PERIODIC_REVIEW_DUE')
        ) {
          continue;
        }
        const { newHit } = await this.screening.run(kyc.id, systemUser.id);
        screened += 1;
        if (newHit) hits += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(
          `Recurring screening batch: customer ${customer.id} failed (${(err as Error).message}) — continuing.`,
        );
      }
    }
    this.logger.log(
      `Recurring screening batch: re-screened ${screened} active customer(s), ${hits} produced a HIT, ${failed} failed.`,
    );
  }
}
