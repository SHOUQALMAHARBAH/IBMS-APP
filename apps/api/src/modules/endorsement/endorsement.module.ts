import { Module } from '@nestjs/common';
import { EndorsementController } from './endorsement.controller';
import { EndorsementService } from './endorsement.service';
import { EndorsementRepository } from '../../repositories/endorsement.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PolicyModule } from '../policy/policy.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { CustomerModule } from '../customer/customer.module';
import { CommissionModule } from '../commission/commission.module';

/** Process 22 — Endorsement Management (backlog Part C #22, Domain B).
 *
 * WorkflowTransitionService comes from the @Global() WorkflowModule (the
 * Endorsement `REQUESTED -> ... -> CLIENT_NOTIFIED` walk and the best-effort
 * Policy `ACTIVE -> CANCELLED` move at APPLY of a cancellation endorsement).
 *   - AuditModule          -> AuditService
 *   - AuthModule           -> guards/decorators (RequirePermissions, CurrentUser)
 *   - PolicyModule         -> PolicyRepository (the parent Policy — visibility,
 *     issued premium / period for the return-premium calc, and the
 *     coverage-schedule versioning at APPLY)
 *   - RecommendationModule -> RecommendationRepository (the placed quotation's
 *     commission rate — for the auto-tied commission reversal)
 *   - CustomerModule       -> CustomerRepository (owner, for visibility)
 *   - CommissionModule     -> CommissionLedgerService (Process 36 — reflect a
 *     cancellation / negative-endorsement CommissionReversal onto the policy's
 *     CommissionLedgerEntry: best-effort `-> reversed`) */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    PolicyModule,
    RecommendationModule,
    CustomerModule,
    CommissionModule,
  ],
  controllers: [EndorsementController],
  providers: [EndorsementService, EndorsementRepository],
})
export class EndorsementModule {}
