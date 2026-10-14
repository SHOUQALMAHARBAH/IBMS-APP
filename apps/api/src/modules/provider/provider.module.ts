import { Module } from '@nestjs/common';
import {
  ProviderOfficeRegistrationController,
  ProviderInsurerRegistrationController,
} from './provider.controller';
import { OfficeRegistrationService } from './office-registration.service';
import { InsuranceCompanyRegistrationService } from './insurance-company-registration.service';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { AuditModule } from '../audit/audit.module';
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
  imports: [AuditModule, SecurityModule],
  controllers: [
    ProviderOfficeRegistrationController,
    ProviderInsurerRegistrationController,
    ReferenceDataController,
  ],
  providers: [
    OfficeRegistrationService,
    InsuranceCompanyRegistrationService,
    ReferenceDataService,
  ],
})
export class ProviderModule {}
