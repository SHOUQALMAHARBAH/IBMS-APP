import { Module } from '@nestjs/common';
import {
  ProviderOfficeRegistrationController,
  ProviderInsurerRegistrationController,
} from './provider.controller';
import { OfficeRegistrationService } from './office-registration.service';
import { OfficeAdministratorInvitationService } from './office-administrator-invitation.service';
import { CompanyAdministratorInvitationService } from './company-administrator-invitation.service';
import { InsuranceCompanyRegistrationService } from './insurance-company-registration.service';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SecurityModule } from '../security/security.module';

/**
 * MODULE 0-ب — the platform operator's own surface.
 *
 * Separate from `compliance-risk`, where item (j)'s read-only provider dashboard lives, because the
 * two do different things to different tables: that one READS a cross-office view, this one CREATES
 * tenants. Keeping them apart means the registration service cannot quietly acquire the dashboard's
 * repositories, or the reverse.
 */
@Module({
  /*
   * `AuthModule` for `PasswordService`, and it is here because of a RUNTIME failure TypeScript
   * cannot see. Item (f)'s invitation service hashes an unusable password, `apps/api` has no
   * `bcrypt` dependency at all (the seed's is in `packages/db`, and this app uses `bcryptjs` via
   * `PasswordService`), and a missing module provider compiles cleanly and fails on the first
   * request. `AuthModule` exports `PasswordService` for exactly this reason — its own `exports`
   * comment names `RbacModule`'s `UserAdminService` hashing a provisioned account with the same
   * policy and cost. Not circular: `AuthModule` does not import this one.
   *
   * The e2e that BOOTS THE APP is what proves this line, not the typecheck — the lesson item (e)
   * paid for when a missing `OrganizationRepository` provider compiled and 500'd.
   */
  imports: [AuditModule, SecurityModule, AuthModule],
  controllers: [
    ProviderOfficeRegistrationController,
    ProviderInsurerRegistrationController,
    ReferenceDataController,
  ],
  providers: [
    OfficeRegistrationService,
    OfficeAdministratorInvitationService,
    InsuranceCompanyRegistrationService,
    CompanyAdministratorInvitationService,
    ReferenceDataService,
  ],
})
export class ProviderModule {}
