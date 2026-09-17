import { Global, Module } from '@nestjs/common';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { UserRepository } from '../../repositories/user.repository';
import { OrgContextService } from './org-context.service';
import { PerOrganizationRunner } from './per-organization.runner';

/**
 * Multi-tenancy Phase 2 (step 7). Global because the org context is genuinely
 * cross-cutting — PrismaService, the auth guard and all 14 background jobs need
 * the same instance, and threading it through every module's imports would
 * make the one thing that must never be skipped the easiest thing to forget.
 *
 * `PerOrganizationRunner` is exported from here for the same reason: thirteen
 * modules run scheduled sweeps, and adding it to each one's `providers` is
 * thirteen chances to wire a job that quietly runs with no Organization.
 *
 * `OrganizationRepository` and `UserRepository` are provided here because the
 * runner depends on them. A module that already provides its own
 * `UserRepository` keeps it — a local provider shadows a global one — so this
 * changes nothing for existing consumers.
 */
@Global()
@Module({
  providers: [
    OrgContextService,
    OrganizationRepository,
    UserRepository,
    PerOrganizationRunner,
  ],
  exports: [OrgContextService, OrganizationRepository, PerOrganizationRunner],
})
export class OrgContextModule {}
