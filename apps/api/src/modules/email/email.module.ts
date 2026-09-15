import { Module } from '@nestjs/common';
import { EmailIntegrationController } from './email-integration.controller';
import { OrganizationEmailIntegrationService } from './organization-email-integration.service';
import { OutboundEmailService } from './outbound-email.service';
import { EmailProviderRegistry } from './email-provider.registry';
import { OrganizationEmailIntegrationRepository } from '../../repositories/organization-email-integration.repository';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { UserRepository } from '../../repositories/user.repository';
import { AuditModule } from '../audit/audit.module';
import { SecurityModule } from '../security/security.module';

/**
 * Part I §6 (multi-tenancy Phase 3 step 11) — per-Organization outbound email.
 *
 * `OutboundEmailService` is exported because it is the ONLY way anything in
 * this system sends mail. Any module that needs to notify somebody imports this
 * one; nothing talks to a mail provider directly, which is what keeps "the
 * office's own mailbox, a reviewed template, never a sensitive payload in the
 * body" true by construction rather than by convention.
 */
@Module({
  imports: [AuditModule, SecurityModule],
  controllers: [EmailIntegrationController],
  providers: [
    OrganizationEmailIntegrationService,
    OutboundEmailService,
    EmailProviderRegistry,
    OrganizationEmailIntegrationRepository,
    OrganizationRepository,
    UserRepository,
  ],
  exports: [OutboundEmailService],
})
export class EmailModule {}
