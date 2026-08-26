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
  // ProspectModule (backlog Part C #2) reads a Lead's status/owner before
  // converting it — reuses this repository rather than duplicating a
  // near-identical one scoped to a single findById call.
  exports: [LeadRepository],
})
export class LeadModule {}
