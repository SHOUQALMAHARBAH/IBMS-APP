import { Global, Module } from '@nestjs/common';
import { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import { RegulatoryActionRepository } from '../../repositories/regulatory-action.repository';
import { LicenseGateService } from './license-gate.service';

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
  ],
  exports: [LicenseGateService],
})
export class LicenseGateModule {}
