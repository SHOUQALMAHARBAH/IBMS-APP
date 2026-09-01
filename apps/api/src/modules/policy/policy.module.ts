import { Module } from '@nestjs/common';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { PolicyRepository } from '../../repositories/policy.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { ClientDecisionModule } from '../client-decision/client-decision.module';
import { CustomerModule } from '../customer/customer.module';

/** Process 18-19 — Policy Placement & Issuance (backlog Part C #18-19, Domain
 * B).
 *
 * WorkflowTransitionService comes from the @Global() WorkflowModule (the
 * Policy `PLACEMENT_CONFIRMED -> ISSUED` transition at issuance).
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
  providers: [PolicyService, PolicyRepository],
  exports: [PolicyRepository],
})
export class PolicyModule {}
