import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SlaTimerService } from './sla-timer.service';
import { SlaTimerScheduler } from './sla-timer.scheduler';
import { SlaPolicyService } from './sla-policy.service';
import { SlaPolicyController } from './sla-policy.controller';
import { SlaTimerController } from './sla-timer.controller';
import { SlaPolicyRepository } from '../../repositories/sla-policy.repository';

@Global()
@Module({
  // AuthModule exports UserRepository — SlaTimerService needs it to resolve
  // the system service account for escalation-sweep audit rows (same reuse
  // rationale as rbac.module.ts).
  // Deliberately does NOT import RbacModule. This module is @Global, so
  // importing Rbac closes a module cycle (Nest reports it as "the module at
  // index [1] is of type undefined"). The regulatory-metadata permission is
  // enforced by a separate ROUTE with its own @RequirePermissions instead,
  // which needs no cross-module dependency at all.
  imports: [AuthModule],
  controllers: [SlaPolicyController, SlaTimerController],
  providers: [
    SlaTimerService,
    SlaTimerScheduler,
    SlaPolicyService,
    SlaPolicyRepository,
  ],
  exports: [SlaTimerService, SlaPolicyService, SlaPolicyRepository],
})
export class SlaModule {}
