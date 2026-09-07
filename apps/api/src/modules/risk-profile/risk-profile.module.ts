import { Module } from '@nestjs/common';
import { RiskProfileController } from './risk-profile.controller';
import { RiskProfileService } from './risk-profile.service';
import { RiskProfileRepository } from '../../repositories/risk-profile.repository';
import { AuditModule } from '../audit/audit.module';
import { CustomerModule } from '../customer/customer.module';

/** Process 5/6 — Risk Profile. Depends on CustomerModule's exported
 * CustomerRepository (a Risk Profile inherits its visibility from its
 * Customer). Exports RiskProfileRepository so NeedsAssessmentModule can
 * resolve a Needs Assessment's parent Risk Profile the same way — and so
 * Process 6 (the asset survey) can build on this without a second
 * repository. */
@Module({
  imports: [AuditModule, CustomerModule],
  controllers: [RiskProfileController],
  providers: [RiskProfileService, RiskProfileRepository],
  exports: [RiskProfileRepository],
})
export class RiskProfileModule {}
