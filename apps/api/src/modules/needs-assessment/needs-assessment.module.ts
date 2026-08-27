import { Module } from '@nestjs/common';
import { NeedsAssessmentController } from './needs-assessment.controller';
import { NeedsAssessmentService } from './needs-assessment.service';
import { NeedsAssessmentRepository } from '../../repositories/needs-assessment.repository';
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
  providers: [NeedsAssessmentService, NeedsAssessmentRepository],
})
export class NeedsAssessmentModule {}
