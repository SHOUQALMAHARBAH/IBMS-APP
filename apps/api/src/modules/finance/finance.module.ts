import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { CollectionService } from './collection.service';
import { ClientAccountingController } from './client-accounting.controller';
import { ClientAccountingService } from './client-accounting.service';
import { InsurerAccountingController } from './insurer-accounting.controller';
import { InsurerAccountingService } from './insurer-accounting.service';
import { PaymentChannelController } from './payment-channel.controller';
import { PaymentChannelService } from './payment-channel.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { InvoiceRepository } from '../../repositories/invoice.repository';
import { PaymentChannelRepository } from '../../repositories/payment-channel.repository';
import { ReconciliationRepository } from '../../repositories/reconciliation.repository';
import { AuditModule } from '../audit/audit.module';
import { PolicyModule } from '../policy/policy.module';
import { RecommendationModule } from '../recommendation/recommendation.module';

/**
 * Process 31–32 — Premium Billing + Collection (backlog Part C #31–32, Domain
 * D — Finance). `InvoiceService` raises the new-business premium `Invoice`
 * against an issued policy (#31); `CollectionService` drives it through the
 * cycle `INVOICED → COLLECTED → RECONCILED → REMITTED` — recording the
 * client's receipt, reconciling the collected funds, and remitting the net
 * premium (`premium − commission`) to the insurer, booking a
 * `ClientFundsLedgerEntry` at each money movement (Part 7.3).
 *
 *   - AuditModule          -> AuditService (CREATE Invoice / Receipt /
 *     Remittance / ClientFundsLedgerEntry rows)
 *   - PolicyModule         -> PolicyRepository (the policy — issued premium,
 *     customer, currency, opportunity, insurer for the remittance)
 *   - RecommendationModule -> RecommendationRepository (the placed quotation's
 *     commissionRatePercent)
 *
 * `Invoice` IS a `WorkflowTransitionService` entity — its `status` moves ONLY
 * through the engine (from the @Global() WorkflowModule, so not imported
 * here). #31 creates it at `@default(INVOICED)`; #32 drives every subsequent
 * hop. The global `PermissionsGuard` + `@CurrentUser` come from RbacModule /
 * the global auth guard (same as CrmModule / LossRatioModule — no AuthModule
 * import needed).
 *
 * `ClientAccountingService` (#33) serves the accounts-receivable / ageing
 * report (`GET /client-accounting/ageing`, `client-accounting.read`);
 * `InsurerAccountingService` (#34) serves the accounts-payable /
 * remittance-obligations report (`GET /insurer-accounting/payables`,
 * `insurer-accounting.read`) — both computed on the fly from the `Invoice` /
 * `Receipt` / `Remittance` rows, no stored aggregate, not audit-logged
 * (invoice / remittance amounts are Confidential, the #31 decision).
 *
 * `PaymentChannelService` (#38) maintains the approved `PaymentChannel` list
 * (`payment-channel.manage` / Finance) — a governed reference list; #32's
 * `CollectionService` validates a supplied `paymentChannelId` against it and
 * records it on the `Receipt` / `Remittance`.
 *
 * `ReconciliationService` (#39) runs the insurer-statement-vs-broker-record
 * variance check (`POST /reconciliation-exceptions/detect`,
 * `reconciliation-exception.investigate` / Finance) — a non-zero variance
 * ALWAYS raises a `ReconciliationException` (never a silent write-off,
 * `money-decimal-jod.md`) and drives the parent `Invoice`
 * `COLLECTED|RECONCILED → EXCEPTION_RAISED` through the engine; the
 * investigate / resolve path closes it and resumes the cycle at the
 * caller-picked `RECONCILED` / `REMITTED`.
 */
@Module({
  imports: [AuditModule, PolicyModule, RecommendationModule],
  controllers: [
    InvoiceController,
    ClientAccountingController,
    InsurerAccountingController,
    PaymentChannelController,
    ReconciliationController,
  ],
  providers: [
    InvoiceService,
    CollectionService,
    ClientAccountingService,
    InsurerAccountingService,
    PaymentChannelService,
    ReconciliationService,
    InvoiceRepository,
    PaymentChannelRepository,
    ReconciliationRepository,
  ],
  exports: [InvoiceRepository],
})
export class FinanceModule {}
