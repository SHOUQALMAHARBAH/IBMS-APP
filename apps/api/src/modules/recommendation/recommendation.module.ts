import { Module } from '@nestjs/common';
import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './recommendation.service';
import { RecommendationReportDocumentService } from './recommendation-report-document.service';
import { RecommendationRepository } from '../../repositories/recommendation.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { QuotationModule } from '../quotation/quotation.module';
import { CustomerModule } from '../customer/customer.module';
import { DocumentGenerationModule } from '../document-generation/document-generation.module';

/** Process 16 — Broker Recommendation (backlog Part C #16, Domain B).
 *
 * WorkflowTransitionService comes from the @Global() WorkflowModule (the
 * best-effort Opportunity COMPARISON_BUILT -> RECOMMENDATION_DRAFTED and
 * RECOMMENDATION_DRAFTED -> SENT_TO_CLIENT moves).
 *   - AuditModule       -> AuditService
 *   - AuthModule        -> guards/decorators (RequirePermissions, CurrentUser)
 *   - OpportunityModule -> OpportunityRepository (the parent Opportunity —
 *     visibility, status gate, targetPremiumThreshold)
 *   - QuotationModule   -> QuotationRepository (the recommended quote + the
 *     competing quotes for the conflict-of-interest check)
 *   - CustomerModule    -> CustomerRepository (owner, for visibility)
 *   - DocumentGenerationModule -> PdfRendererService +
 *     DocumentTemplateRepository (Part F item #7 — bilingual
 *     recommendation-report PDF, `RecommendationReportDocumentService`) */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    OpportunityModule,
    QuotationModule,
    CustomerModule,
    DocumentGenerationModule,
  ],
  controllers: [RecommendationController],
  providers: [
    RecommendationService,
    RecommendationReportDocumentService,
    RecommendationRepository,
  ],
  // ClientDecisionModule (backlog Part C #17) reads the sent Recommendation
  // as the precondition for capturing a client decision.
  exports: [RecommendationRepository],
})
export class RecommendationModule {}
