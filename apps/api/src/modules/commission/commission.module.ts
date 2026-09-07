import { Module } from '@nestjs/common';
import { CommissionController } from './commission.controller';
import { CommissionAgreementService } from './commission-agreement.service';
import { CommissionLedgerService } from './commission-ledger.service';
import { CommissionRepository } from '../../repositories/commission.repository';
import { AuditModule } from '../audit/audit.module';
import { PolicyModule } from '../policy/policy.module';

/**
 * Process 35 (backlog Part C #35, Domain D — Finance) — Commission
 * Calculation.
 *
 *   - `CommissionAgreementService` — the governed rate table
 *     (`CommissionAgreement`, by insurer + line, time-windowed);
 *     `commission-rate.manage` (Compliance / Manager — Finance may apply but
 *     not alter the table).
 *   - `CommissionLedgerService` — the `CommissionLedgerEntry` ledger:
 *     `calculate` at the governed rate (`commission.calculate` / Finance, no
 *     maker/checker, write-once per policy), and the manual-override
 *     maker/checker pair (`commission-override.raise` / Finance →
 *     `commission-override.approve` / Manager, `assertDifferentActors` + the
 *     `CommissionLedgerEntry_maker_checker_distinct` CHECK).
 *
 *   - AuditModule  -> AuditService (CREATE / UPDATE / APPROVE rows)
 *   - PolicyModule -> PolicyRepository (the policy's insurer / line / issued
 *     premium / inception date for the governed lookup)
 *
 * The global `PermissionsGuard` + `@CurrentUser` come from RbacModule / the
 * global auth guard (no AuthModule import, same as FinanceModule).
 */
@Module({
  imports: [AuditModule, PolicyModule],
  controllers: [CommissionController],
  providers: [
    CommissionAgreementService,
    CommissionLedgerService,
    CommissionRepository,
  ],
  // CommissionLedgerService is exported so EndorsementModule (Process 22) can
  // best-effort `reconcileReversalForPolicy` after minting a CommissionReversal
  // (Process 36 — the `-> reversed` lifecycle move).
  exports: [CommissionRepository, CommissionLedgerService],
})
export class CommissionModule {}
