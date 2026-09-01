import { Module } from '@nestjs/common';
import { ClientDecisionController } from './client-decision.controller';
import { ClientDecisionService } from './client-decision.service';
import { ClientDecisionRepository } from '../../repositories/client-decision.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { CustomerModule } from '../customer/customer.module';

/** Process 17 — Client Decision Handling (backlog Part C #17, Domain B).
 *
 * WorkflowTransitionService comes from the @Global() WorkflowModule (the
 * best-effort Opportunity routing SENT_TO_CLIENT -> CLIENT_DECISION ->
 * PLACEMENT | CLOSED_LOST | RENEGOTIATE).
 *   - AuditModule          -> AuditService
 *   - AuthModule           -> guards/decorators
 *   - OpportunityModule    -> OpportunityRepository (visibility + status)
 *   - RecommendationModule -> RecommendationRepository (the precondition —
 *     a recommendation must have been sent to the client)
 *   - CustomerModule       -> CustomerRepository (owner, for visibility) */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    OpportunityModule,
    RecommendationModule,
    CustomerModule,
  ],
  controllers: [ClientDecisionController],
  providers: [ClientDecisionService, ClientDecisionRepository],
  // PolicyModule (backlog Part C #18-19) reads the ACCEPT decision as the
  // authoritative precondition for placing a Policy.
  exports: [ClientDecisionRepository],
})
export class ClientDecisionModule {}
