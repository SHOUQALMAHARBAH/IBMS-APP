import { Module } from '@nestjs/common';
import { QuotationController } from './quotation.controller';
import { QuotationService } from './quotation.service';
import { QuotationRepository } from '../../repositories/quotation.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RfqModule } from '../rfq/rfq.module';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { CustomerModule } from '../customer/customer.module';

/** Process 13 — Quotation Management (backlog Part C #13, Domain B).
 *
 * WorkflowTransitionService comes from the @Global() WorkflowModule (the
 * best-effort RFQInsurer -> QUOTED and Opportunity RFQ_ISSUED ->
 * QUOTES_RECEIVED moves on a successful capture / revise).
 *   - AuditModule       -> AuditService (CREATE per captured version;
 *     TRANSITION rows for the best-effort moves come from the engine)
 *   - AuthModule        -> guards/decorators (RequirePermissions,
 *     CurrentUser) — same import every business module carries
 *   - RfqModule         -> RfqRepository (the parent RFQ + its insurer
 *     shortlist — a quote can only come from a shortlisted insurer)
 *   - OpportunityModule -> OpportunityRepository (the RFQ's Opportunity —
 *     for visibility and the QUOTES_RECEIVED move)
 *   - CustomerModule    -> CustomerRepository (that Opportunity's Customer
 *     owner, for visibility) */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    RfqModule,
    OpportunityModule,
    CustomerModule,
  ],
  controllers: [QuotationController],
  providers: [QuotationService, QuotationRepository],
  // ComparisonModule (backlog Part C #14) reads every current-version
  // Quotation on an RFQ through QuotationRepository.
  exports: [QuotationRepository],
})
export class QuotationModule {}
