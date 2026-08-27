import { Module } from '@nestjs/common';
import { InsuranceProgramController } from './insurance-program.controller';
import { InsuranceProgramService } from './insurance-program.service';
import { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import { AuditModule } from '../audit/audit.module';
import { CustomerModule } from '../customer/customer.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { NeedsAssessmentModule } from '../needs-assessment/needs-assessment.module';

/** Process 7 — Product Recommendation / Program Design (backlog Part C #7).
 *
 * WorkflowTransitionService comes from the @Global() WorkflowModule
 * (imported once in AppModule) — no explicit import needed here. The other
 * three modules export the repositories this one reads from:
 *   - NeedsAssessmentModule -> NeedsAssessmentRepository (the APPROVED
 *     assessment whose coverage list is assembled)
 *   - RiskProfileModule     -> RiskProfileRepository (that assessment's
 *     parent Risk Profile + its asset survey, for the Sum Insured basis)
 *   - CustomerModule        -> CustomerRepository (that Risk Profile's
 *     Customer owner, for visibility) */
@Module({
  imports: [
    AuditModule,
    NeedsAssessmentModule,
    RiskProfileModule,
    CustomerModule,
  ],
  controllers: [InsuranceProgramController],
  providers: [InsuranceProgramService, InsuranceProgramRepository],
})
export class InsuranceProgramModule {}
