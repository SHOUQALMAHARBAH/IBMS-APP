import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SlaTimerService } from './sla-timer.service';
import { SlaTimerScheduler } from './sla-timer.scheduler';

@Global()
@Module({
  // AuthModule exports UserRepository — SlaTimerService needs it to resolve
  // the system service account for escalation-sweep audit rows (same reuse
  // rationale as rbac.module.ts).
  imports: [AuthModule],
  providers: [SlaTimerService, SlaTimerScheduler],
  exports: [SlaTimerService],
})
export class SlaModule {}
