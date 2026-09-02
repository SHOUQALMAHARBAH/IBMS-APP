import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { CollectionService } from './collection.service';
import { InvoiceRepository } from '../../repositories/invoice.repository';
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
 */
@Module({
  imports: [AuditModule, PolicyModule, RecommendationModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, CollectionService, InvoiceRepository],
  exports: [InvoiceRepository],
})
export class FinanceModule {}
