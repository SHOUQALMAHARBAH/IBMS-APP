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
  // CustomerModule (backlog Part C #3-4) validates a Customer's optional
  // prospectId link the same way this module validates a Prospect's leadId
  // — reuses this repository rather than duplicating a near-identical one.
  exports: [ProspectRepository],
})
export class ProspectModule {}
