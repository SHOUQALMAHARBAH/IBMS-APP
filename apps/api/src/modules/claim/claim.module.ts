import { Module } from '@nestjs/common';
import { ClaimController } from './claim.controller';
import { ClaimService } from './claim.service';
import { ClaimFollowUpScheduler } from './claim-followup.scheduler';
import { ClaimRepository } from '../../repositories/claim.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SecurityModule } from '../security/security.module';
import { PolicyModule } from '../policy/policy.module';
import { CustomerModule } from '../customer/customer.module';

/** Process 23-27 — Claim Notification + Registration + Documentation +
 * Assessment + Follow-up (backlog Part C #23-27, Domain C).
 *
 * `Claim` IS a `WorkflowTransitionService` entity — the engine comes from the
 * @Global() WorkflowModule (so it is not imported here). #23 creates the
 * claim at the schema `@default(NOTIFIED)` (no transition); #24 drives the
 * first real engine transition on it, `NOTIFIED -> REGISTERED`.
 *   - AuditModule    -> AuditService
 *   - AuthModule     -> guards/decorators (RequirePermissions, CurrentUser) +
 *     UserRepository (the #27 follow-up scheduler resolves the system service
 *     account, same as the cross-sell / up-sell / RFQ schedulers)
 *   - SecurityModule -> EncryptionService (ThirdPartyClaimant.contactDetailsEnc,
 *     `-- ENCRYPT`)
 *   - PolicyModule   -> PolicyRepository (the parent Policy — visibility and
 *     every PolicySchedule window, for "coverage in force at the loss date")
 *   - CustomerModule -> CustomerRepository (owner, for visibility)
 *
 * `ClaimFollowUpScheduler` (@Cron) drives the nightly Process 27 insurer
 * non-response sweep; ScheduleModule.forRoot() is registered in app.module.ts. */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    SecurityModule,
    PolicyModule,
    CustomerModule,
  ],
  controllers: [ClaimController],
  providers: [ClaimService, ClaimRepository, ClaimFollowUpScheduler],
})
export class ClaimModule {}
