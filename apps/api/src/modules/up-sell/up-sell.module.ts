import { Module } from '@nestjs/common';
import { UpSellController } from './up-sell.controller';
import { UpSellService } from './up-sell.service';
import { UpSellDetectionScheduler } from './up-sell-detection.scheduler';
import { UpSellRecommendationRepository } from '../../repositories/up-sell-recommendation.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { InsuranceProgramModule } from '../insurance-program/insurance-program.module';

/** Process 9 — Up-Selling (backlog Part C #9).
 *
 * WorkflowTransitionService comes from the @Global() WorkflowModule
 * (imported once in AppModule) — no explicit import needed here.
 *   - AuditModule            -> AuditService (the CREATE audit row per
 *     flagged recommendation; WorkflowTransitionService writes the
 *     TRANSITION row on convert/dismiss)
 *   - AuthModule             -> UserRepository (the scheduler resolves the
 *     system service account, same as the other schedulers)
 *   - CustomerModule         -> CustomerRepository (a recommendation
 *     inherits its Customer's owner for visibility)
 *   - RiskProfileModule      -> RiskProfileRepository (the customer's asset
 *     survey, for `currentAssetValue`)
 *   - InsuranceProgramModule -> InsuranceProgramRepository (the customer's
 *     live programme lines, for `currentSumInsured`) */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    CustomerModule,
    RiskProfileModule,
    InsuranceProgramModule,
  ],
  controllers: [UpSellController],
  providers: [
    UpSellService,
    UpSellDetectionScheduler,
    UpSellRecommendationRepository,
  ],
})
export class UpSellModule {}
