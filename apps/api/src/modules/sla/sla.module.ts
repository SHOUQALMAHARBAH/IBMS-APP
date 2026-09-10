import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SlaTimerService } from './sla-timer.service';
import { SlaTimerScheduler } from './sla-timer.scheduler';
import { SlaPolicyService } from './sla-policy.service';
import { SlaPolicyController } from './sla-policy.controller';
import { SlaPolicyRepository } from '../../repositories/sla-policy.repository';

@Global()
@Module({
  // AuthModule exports UserRepository — SlaTimerService needs it to resolve
  // the system service account for escalation-sweep audit rows (same reuse
  // rationale as rbac.module.ts).
  // RbacModule exports PermissionsService — the SLA policy controller
  // resolves the regulatory-metadata permission the same way PermissionsGuard
  // does, so there is one notion of "holds this permission".
  imports: [AuthModule, RbacModule],
  controllers: [SlaPolicyController],
  providers: [
    SlaTimerService,
    SlaTimerScheduler,
    SlaPolicyService,
    SlaPolicyRepository,
  ],
  exports: [SlaTimerService, SlaPolicyService, SlaPolicyRepository],
})
export class SlaModule {}
