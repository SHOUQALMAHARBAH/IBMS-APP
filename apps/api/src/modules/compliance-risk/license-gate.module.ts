import { Global, Module } from '@nestjs/common';
import { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import { RegulatoryActionRepository } from '../../repositories/regulatory-action.repository';
import { LicenseGateService } from './license-gate.service';
import { LegalValueService } from './legal-value.service';
import { LegalValueRepository } from '../../repositories/legal-value.repository';

/**
 * `@Global()`, for the reason `WorkflowModule` and `DutySegregationModule` are — and the reason is
 * stated rather than inherited: six acts in five modules must refuse an office that may not
 * practise, and adding an import to five modules is a list somebody will forget to extend when the
 * seventh act arrives.
 *
 * The alternative — each module injecting two repositories and calling the pure derivation — puts
 * the term read, the act read, the fold and the refusal wording in five places. That is precisely
 * the defect this gate exists to remove: before it, three different answers to "is this office
 * licensed" existed and only the narrowest one enforced anything.
 */
@Global()
@Module({
  providers: [
    LicenseGateService,
    BrokerLicenseRepository,
    RegulatoryActionRepository,
    // OWNER DECISION 123's legal-values reader. Exported for the SAME reason the gate is: the
    // capital assessment is called from `provider/office-registration.service.ts`, in a different
    // module, and a figure read in two places by two routes is two answers.
    LegalValueService,
    LegalValueRepository,
  ],
  exports: [LicenseGateService, LegalValueService],
})
export class LicenseGateModule {}
