import { Module } from '@nestjs/common';
import { RfqController } from './rfq.controller';
import { RfqInsurerController } from './rfq-insurer.controller';
import { RfqService } from './rfq.service';
import { RfqFollowUpScheduler } from './rfq-followup.scheduler';
import { RfqRepository } from '../../repositories/rfq.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { InsuranceProgramModule } from '../insurance-program/insurance-program.module';

/** Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B).
 *
 * WorkflowTransitionService comes from the @Global() WorkflowModule (the
 * Opportunity NEEDS_CONFIRMED -> RFQ_ISSUED move on the first RFQ, and every
 * RFQInsurer response-status move).
 *   - AuditModule            -> AuditService (CREATE per RFQ, UPDATE per
 *     shortlist extension / follow-up alert; TRANSITION rows come from the
 *     engine)
 *   - AuthModule             -> UserRepository (the scheduler resolves the
 *     system service account, same as the cross-sell / up-sell schedulers)
 *   - OpportunityModule      -> OpportunityRepository (the parent Opportunity
 *     — loaded for visibility and for the RFQ_ISSUED transition)
 *   - InsuranceProgramModule -> InsuranceProgramRepository (the designed
 *     programme's canonical line set — an RFQ line must be one of them)
 *   - CustomerModule         -> CustomerRepository (that Opportunity's
 *     Customer owner, for visibility) */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    OpportunityModule,
    InsuranceProgramModule,
    CustomerModule,
  ],
  controllers: [RfqController, RfqInsurerController],
  providers: [RfqService, RfqRepository, RfqFollowUpScheduler],
  // QuotationModule (backlog Part C #13) reads the parent RFQ + its insurer
  // shortlist through RfqRepository — a quote can only come from a
  // shortlisted insurer.
  exports: [RfqRepository],
})
export class RfqModule {}
