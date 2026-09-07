import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { InteractionRepository } from '../../repositories/interaction.repository';
import { AuditModule } from '../audit/audit.module';
import { CustomerModule } from '../customer/customer.module';

/** Process 10 — Relationship Management (CRM) (backlog Part C #10).
 *
 *   - AuditModule    -> AuditService (the CREATE row per logged interaction,
 *     and the sensitive-data READ row for a 360° view that surfaced a claim)
 *   - CustomerModule -> CustomerRepository (an interaction / 360° view
 *     inherits its Customer's owner for read visibility, same reuse as
 *     cross-sell.module.ts / up-sell.module.ts)
 *
 * No WorkflowModule — `Interaction` carries no status. No AuthModule — there
 * is no scheduler / system service account here. */
@Module({
  imports: [AuditModule, CustomerModule],
  controllers: [CrmController],
  providers: [CrmService, InteractionRepository],
})
export class CrmModule {}
