import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { ScreeningController } from './screening.controller';
import { ScreeningService } from './screening.service';
import { ScreeningBatchScheduler } from './screening-batch.scheduler';
import { KycPeriodicReviewScheduler } from './kyc-periodic-review.scheduler';
import { CustomerRepository } from '../../repositories/customer.repository';
import { KycRecordRepository } from '../../repositories/kyc-record.repository';
import { WatchlistEntryRepository } from '../../repositories/watchlist-entry.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SecurityModule } from '../security/security.module';
import { ProspectModule } from '../prospect/prospect.module';

// WorkflowTransitionService and SlaTimerService come from the @Global()
// WorkflowModule/SlaModule (each imported once in AppModule) — no explicit
// import needed here.
@Module({
  imports: [
    AuditModule,
    // AuthModule exports UserRepository — needed by both schedulers to
    // resolve the system service account (same reuse rationale as
    // sla.module.ts/rbac.module.ts).
    AuthModule,
    // Field-level encryption + masked/justified-drill-down display (A.3/A.9)
    // for Customer.nationalIdEnc/contactPhoneEnc/contactEmailEnc and
    // UltimateBeneficialOwner.nationalIdEnc — this module is their first
    // real consumer.
    SecurityModule,
    // Validates a Customer's optional prospectId link (mirrors
    // ProspectModule's own leadId validation against LeadModule).
    ProspectModule,
  ],
  controllers: [CustomerController, KycController, ScreeningController],
  providers: [
    CustomerService,
    KycService,
    ScreeningService,
    ScreeningBatchScheduler,
    KycPeriodicReviewScheduler,
    CustomerRepository,
    KycRecordRepository,
    // Process 49 — ScreeningService's real (non-fixture) sanctions/PEP
    // check. A stateless PrismaService wrapper, also provided directly by
    // ComplianceRiskModule (which owns the sync writing these rows) —
    // instantiating it twice is safe and avoids a cross-module import.
    WatchlistEntryRepository,
  ],
  // RiskProfileModule (Part C #5) reads a Customer's owner to resolve
  // visibility on Risk Profiles / Needs Assessments hung off it — reuses
  // this repository rather than duplicating a near-identical one (same
  // rationale as ProspectModule exporting ProspectRepository).
  exports: [CustomerRepository],
})
export class CustomerModule {}
