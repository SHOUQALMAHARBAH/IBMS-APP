import { Module } from '@nestjs/common';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { PolicyCheckingService } from './policy-checking.service';
import { PolicyDeliveryService } from './policy-delivery.service';
import { PolicyScheduleSummaryDocumentService } from './policy-schedule-summary-document.service';
import { CertificateOfInsuranceDocumentService } from './certificate-of-insurance-document.service';
import { PolicyRepository } from '../../repositories/policy.repository';
import { PolicyCheckingRepository } from '../../repositories/policy-checking.repository';
import { PolicyDeliveryRepository } from '../../repositories/policy-delivery.repository';
import { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import { PiPolicyRepository } from '../../repositories/pi-policy.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { ClientDecisionModule } from '../client-decision/client-decision.module';
import { CustomerModule } from '../customer/customer.module';
import { DocumentGenerationModule } from '../document-generation/document-generation.module';

/** Process 18-19 — Policy Placement & Issuance + Process 20 — Policy Checking
 * + Process 21 — Policy Delivery (backlog Part C #18-21, Domain B).
 *
 * WorkflowTransitionService comes from the @Global() WorkflowModule (the
 * Policy `PLACEMENT_CONFIRMED -> ISSUED` transition at issuance, the
 * `(ISSUED | DISCREPANCY) -> CHECKING_IN_PROGRESS -> (VERIFIED | DISCREPANCY)`
 * walk at checking, and `VERIFIED -> DELIVERED -> ACTIVE` at delivery).
 *   - AuditModule           -> AuditService
 *   - AuthModule            -> guards/decorators (RequirePermissions, CurrentUser)
 *   - OpportunityModule     -> OpportunityRepository (the parent Opportunity —
 *     visibility)
 *   - RecommendationModule  -> RecommendationRepository (the accepted
 *     recommendation's quotation — insurer / line / premium / currency)
 *   - ClientDecisionModule  -> ClientDecisionRepository (the ACCEPT decision,
 *     the authoritative placement precondition)
 *   - CustomerModule        -> CustomerRepository (owner, for visibility)
 *   - DocumentGenerationModule -> PdfRendererService +
 *     DocumentTemplateRepository (Part F item #7 — bilingual
 *     policy-schedule-summary PDF, `PolicyScheduleSummaryDocumentService`,
 *     and the certificate-of-insurance PDF,
 *     `CertificateOfInsuranceDocumentService` — both reuse the SAME
 *     `PolicyService.getByIdWithCustomer()` visibility read and
 *     `schedules.length === 0` data-availability gate, deliberately
 *     different CONTENT)
 *
 * `BrokerLicenseRepository` (Process 51, backlog Part C #51's first
 * checkbox — "automatically block new business issuance once the license
 * lapses") is provided directly here too, rather than importing
 * `ComplianceRiskModule` (which owns it) — a stateless `PrismaService`
 * wrapper, safe to instantiate twice, the `WatchlistEntryRepository` (#49)
 * shape, avoiding a `PolicyModule` <-> `ComplianceRiskModule` dependency for
 * one narrow read. `PolicyService.place()` is the ONLY caller.
 *
 * `PiPolicyRepository` (Process 53-54) is provided the same way —
 * `PolicyCheckingRepository.findLatestPiPolicyId` (Process 20/54's
 * discrepancy auto-link) is its only caller here. */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    OpportunityModule,
    RecommendationModule,
    ClientDecisionModule,
    CustomerModule,
    DocumentGenerationModule,
  ],
  controllers: [PolicyController],
  providers: [
    PolicyService,
    PolicyRepository,
    PolicyCheckingService,
    PolicyCheckingRepository,
    PolicyDeliveryService,
    PolicyDeliveryRepository,
    PolicyScheduleSummaryDocumentService,
    CertificateOfInsuranceDocumentService,
    BrokerLicenseRepository,
    PiPolicyRepository,
  ],
  exports: [PolicyRepository],
})
export class PolicyModule {}
