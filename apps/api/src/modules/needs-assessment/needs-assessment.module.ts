import { Module } from '@nestjs/common';
import { NeedsAssessmentController } from './needs-assessment.controller';
import { NeedsAssessmentService } from './needs-assessment.service';
import { NeedsAssessmentRepository } from '../../repositories/needs-assessment.repository';
import { UserRepository } from '../../repositories/user.repository';
import { AuditModule } from '../audit/audit.module';
import { CustomerModule } from '../customer/customer.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';

// WorkflowTransitionService comes from the @Global() WorkflowModule
// (imported once in AppModule) — no explicit import needed here.
@Module({
  imports: [
    AuditModule,
    // RiskProfileModule exports RiskProfileRepository (resolve a Needs
    // Assessment's parent Risk Profile); CustomerModule exports
    // CustomerRepository (resolve that Risk Profile's Customer owner for
    // visibility).
    RiskProfileModule,
    CustomerModule,
  ],
  controllers: [NeedsAssessmentController],
  // `UserRepository` PROVIDED here rather than imported from AuthModule, which is this
  // codebase's convention for a repository: repositories are shared across modules and
  // services never are. Decision 48's resolver answers WHO REVIEWED and WHO APPROVED by
  // name, which the screen rendered as two uuids under their Arabic labels.
  providers: [
    NeedsAssessmentService,
    NeedsAssessmentRepository,
    UserRepository,
  ],
  // Exported so InsuranceProgramModule (Part C #7) can resolve the APPROVED
  // Needs Assessment whose recommendedCoverageLines drive program assembly —
  // same "export the repository for a downstream consumer" shape
  // RiskProfileModule uses for this module.
  exports: [NeedsAssessmentRepository],
})
export class NeedsAssessmentModule {}
