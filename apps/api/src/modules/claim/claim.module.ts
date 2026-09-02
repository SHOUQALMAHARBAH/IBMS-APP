import { Module } from '@nestjs/common';
import { ClaimController } from './claim.controller';
import { ClaimService } from './claim.service';
import { ClaimRepository } from '../../repositories/claim.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SecurityModule } from '../security/security.module';
import { PolicyModule } from '../policy/policy.module';
import { CustomerModule } from '../customer/customer.module';

/** Process 23-24 — Claim Notification + Registration (backlog Part C #23-24,
 * Domain C).
 *
 * `Claim` IS a `WorkflowTransitionService` entity — the engine comes from the
 * @Global() WorkflowModule (so it is not imported here). #23 creates the
 * claim at the schema `@default(NOTIFIED)` (no transition); #24 drives the
 * first real engine transition on it, `NOTIFIED -> REGISTERED`.
 *   - AuditModule    -> AuditService
 *   - AuthModule     -> guards/decorators (RequirePermissions, CurrentUser)
 *   - SecurityModule -> EncryptionService (ThirdPartyClaimant.contactDetailsEnc,
 *     `-- ENCRYPT`)
 *   - PolicyModule   -> PolicyRepository (the parent Policy — visibility and
 *     every PolicySchedule window, for "coverage in force at the loss date")
 *   - CustomerModule -> CustomerRepository (owner, for visibility) */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    SecurityModule,
    PolicyModule,
    CustomerModule,
  ],
  controllers: [ClaimController],
  providers: [ClaimService, ClaimRepository],
})
export class ClaimModule {}
