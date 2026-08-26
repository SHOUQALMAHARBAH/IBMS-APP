import { Module } from '@nestjs/common';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';
import { LeadRepository } from '../../repositories/lead.repository';
import { AuditModule } from '../audit/audit.module';

// WorkflowTransitionService comes from the @Global() WorkflowModule
// (imported once in AppModule) — no explicit import needed here.
@Module({
  imports: [AuditModule],
  controllers: [LeadController],
  providers: [LeadService, LeadRepository],
})
export class LeadModule {}
