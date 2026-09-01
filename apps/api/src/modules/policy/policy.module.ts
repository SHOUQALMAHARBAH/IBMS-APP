import { Module } from '@nestjs/common';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { PolicyCheckingService } from './policy-checking.service';
import { PolicyDeliveryService } from './policy-delivery.service';
import { PolicyRepository } from '../../repositories/policy.repository';
import { PolicyCheckingRepository } from '../../repositories/policy-checking.repository';
import { PolicyDeliveryRepository } from '../../repositories/policy-delivery.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { ClientDecisionModule } from '../client-decision/client-decision.module';
import { CustomerModule } from '../customer/customer.module';

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
 *   - CustomerModule        -> CustomerRepository (owner, for visibility) */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    OpportunityModule,
    RecommendationModule,
    ClientDecisionModule,
    CustomerModule,
  ],
  controllers: [PolicyController],
  providers: [
    PolicyService,
    PolicyRepository,
    PolicyCheckingService,
    PolicyCheckingRepository,
    PolicyDeliveryService,
    PolicyDeliveryRepository,
  ],
  exports: [PolicyRepository],
})
export class PolicyModule {}
