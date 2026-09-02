import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceRepository } from '../../repositories/invoice.repository';
import { AuditModule } from '../audit/audit.module';
import { PolicyModule } from '../policy/policy.module';
import { RecommendationModule } from '../recommendation/recommendation.module';

/**
 * Process 31 — Premium Billing (backlog Part C #31, Domain D — Finance). The
 * first Domain D module: `InvoiceService` raises the new-business premium
 * `Invoice` against an issued policy (premium carried from the policy,
 * commission auto-derived from the placed quotation rate, tax + fees supplied
 * by Finance, total computed server-side).
 *
 *   - AuditModule          -> AuditService (the CREATE Invoice row)
 *   - PolicyModule         -> PolicyRepository (the policy — issued premium,
 *     customer, currency, opportunity)
 *   - RecommendationModule -> RecommendationRepository (the placed quotation's
 *     commissionRatePercent)
 *
 * `Invoice` IS a `WorkflowTransitionService` entity (the engine comes from
 * the @Global() WorkflowModule) but #31 only creates it at the schema
 * `@default(INVOICED)` — the `INVOICED -> COLLECTED` cycle is Process 32.
 * The global `PermissionsGuard` + `@CurrentUser` come from RbacModule / the
 * global auth guard (same as CrmModule / LossRatioModule — no AuthModule
 * import needed).
 */
@Module({
  imports: [AuditModule, PolicyModule, RecommendationModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceRepository],
  exports: [InvoiceRepository],
})
export class FinanceModule {}
