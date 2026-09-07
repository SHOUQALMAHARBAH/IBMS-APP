import { Module } from '@nestjs/common';
import { OpportunityController } from './opportunity.controller';
import { OpportunityService } from './opportunity.service';
import { OpportunityRepository } from '../../repositories/opportunity.repository';
import { AuditModule } from '../audit/audit.module';
import { CustomerModule } from '../customer/customer.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { InsuranceProgramModule } from '../insurance-program/insurance-program.module';

/** Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). The
 * minimal Opportunity parent module.
 *
 * WorkflowTransitionService (needed by RfqModule, not here) comes from the
 * @Global() WorkflowModule. The imported modules export the repositories
 * this one reads:
 *   - InsuranceProgramModule -> InsuranceProgramRepository (the FINALIZED
 *     programme an Opportunity is created from)
 *   - RiskProfileModule      -> RiskProfileRepository (that programme's
 *     parent Risk Profile, to resolve the Customer)
 *   - CustomerModule         -> CustomerRepository (that Customer's owner,
 *     for visibility)
 *
 * Exports OpportunityRepository so RfqModule (same backlog item) can load an
 * Opportunity and drive its NEEDS_CONFIRMED -> RFQ_ISSUED transition. */
@Module({
  imports: [
    AuditModule,
    InsuranceProgramModule,
    RiskProfileModule,
    CustomerModule,
  ],
  controllers: [OpportunityController],
  providers: [OpportunityService, OpportunityRepository],
  exports: [OpportunityRepository],
})
export class OpportunityModule {}
