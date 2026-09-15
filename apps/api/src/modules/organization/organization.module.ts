import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller';
import { OrganizationResolutionService } from './organization-resolution.service';
import { OrganizationRepository } from '../../repositories/organization.repository';

/**
 * Part II §4.10 — subdomain-to-Organization resolution.
 *
 * Exported because `TenantMatchGuard` needs it on every authenticated request,
 * not just at the sign-in screen.
 */
@Module({
  controllers: [OrganizationController],
  providers: [OrganizationResolutionService, OrganizationRepository],
  exports: [OrganizationResolutionService],
})
export class OrganizationModule {}
