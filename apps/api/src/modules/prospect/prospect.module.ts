import { Module } from '@nestjs/common';
import { ProspectController } from './prospect.controller';
import { ProspectService } from './prospect.service';
import { ProspectRepository } from '../../repositories/prospect.repository';
import { AuditModule } from '../audit/audit.module';
import { LeadModule } from '../lead/lead.module';

// WorkflowTransitionService comes from the @Global() WorkflowModule
// (imported once in AppModule) — no explicit import needed here.
@Module({
  imports: [AuditModule, LeadModule],
  controllers: [ProspectController],
  providers: [ProspectService, ProspectRepository],
})
export class ProspectModule {}
