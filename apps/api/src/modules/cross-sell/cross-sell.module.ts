import { Module } from '@nestjs/common';
import { CrossSellController } from './cross-sell.controller';
import { CrossSellService } from './cross-sell.service';
import { CrossSellDetectionScheduler } from './cross-sell-detection.scheduler';
import { CrossSellOpportunityRepository } from '../../repositories/cross-sell-opportunity.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';

/** Process 8 — Cross-Selling (backlog Part C #8).
 *
 * WorkflowTransitionService comes from the @Global() WorkflowModule
 * (imported once in AppModule) — no explicit import needed here.
 *   - AuditModule    -> AuditService (the CREATE audit row per flagged gap;
 *     WorkflowTransitionService writes the TRANSITION row on convert/dismiss)
 *   - AuthModule     -> UserRepository (the scheduler resolves the system
 *     service account, same as ScreeningBatchScheduler)
 *   - CustomerModule -> CustomerRepository (an opportunity inherits its
 *     Customer's owner for visibility, same as InsuranceProgramService) */
@Module({
  imports: [AuditModule, AuthModule, CustomerModule],
  controllers: [CrossSellController],
  providers: [
    CrossSellService,
    CrossSellDetectionScheduler,
    CrossSellOpportunityRepository,
  ],
})
export class CrossSellModule {}
