import { Module } from '@nestjs/common';
import { ComparisonController } from './comparison.controller';
import { ComparisonService } from './comparison.service';
import { QuotationComparisonDocumentService } from './quotation-comparison-document.service';
import { ComparisonRepository } from '../../repositories/comparison.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RfqModule } from '../rfq/rfq.module';
import { QuotationModule } from '../quotation/quotation.module';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { CustomerModule } from '../customer/customer.module';
import { DocumentGenerationModule } from '../document-generation/document-generation.module';

/** Process 14 — Quote Comparison (backlog Part C #14, Domain B).
 *
 * WorkflowTransitionService comes from the @Global() WorkflowModule (the
 * best-effort Opportunity QUOTES_RECEIVED -> COMPARISON_BUILT move on a
 * build).
 *   - AuditModule       -> AuditService (CREATE / UPDATE per build)
 *   - AuthModule        -> guards/decorators (RequirePermissions, CurrentUser)
 *   - RfqModule         -> RfqRepository (the RFQ + its insurer shortlist —
 *     for the row set and the missing/declined buckets)
 *   - QuotationModule   -> QuotationRepository (every current-version quote
 *     on the RFQ — the matrix rows)
 *   - OpportunityModule -> OpportunityRepository (the RFQ's Opportunity —
 *     for visibility and the COMPARISON_BUILT move)
 *   - CustomerModule    -> CustomerRepository (that Opportunity's Customer
 *     owner, for visibility)
 *   - DocumentGenerationModule -> PdfRendererService +
 *     DocumentTemplateRepository (Part F item #7 — bilingual
 *     quotation-comparison PDF, `QuotationComparisonDocumentService`) */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    RfqModule,
    QuotationModule,
    OpportunityModule,
    CustomerModule,
    DocumentGenerationModule,
  ],
  controllers: [ComparisonController],
  providers: [
    ComparisonService,
    QuotationComparisonDocumentService,
    ComparisonRepository,
  ],
})
export class ComparisonModule {}
