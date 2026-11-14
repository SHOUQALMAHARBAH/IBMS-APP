import { Global, Module } from '@nestjs/common';
import { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import { RegulatoryActionRepository } from '../../repositories/regulatory-action.repository';
import { LicenseGateService } from './license-gate.service';
import { LegalValueService } from './legal-value.service';
import { LegalValueRepository } from '../../repositories/legal-value.repository';
import { Article15DService } from './article-15-d.service';
import { Article15DRepository } from '../../repositories/article-15-d.repository';
import { DeclaredActService } from './declared-act.service';
import { DeclaredActRepository } from '../../repositories/declared-act.repository';
import { UserRepository } from '../../repositories/user.repository';

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
    /*
     * ART. 15/d, EXPORTED FOR THE SAME REASON THE GATE IS: it has TWO callers in two modules --
     * `RfqService` evaluates a request as it is created, and `QuotationService` compares a quote
     * that comes back against the ceiling the request was sent under. Two modules asking one
     * legal question is exactly the shape that produced three different answers to "is this
     * office licensed" before the gate existed.
     */
    Article15DService,
    Article15DRepository,
    /* Its first caller anywhere. `DeclaredActService` shipped in message 36 with no module
     * providing it, because nothing called it yet -- a missing provider is a RUNTIME DI failure
     * TypeScript cannot see, so it lands in the SAME commit as the dependency. */
    DeclaredActService,
    DeclaredActRepository,
    /* The actor's display name, for OWNER DECISION 48: a register that can only name a uuid is
     * a register nobody can read. Provided directly, which is the established shape here --
     * `org-context`, `duty-segregation` and `email` all do the same, and unlike
     * `PermissionsService` a repository holds no cache for a second instance to miss. */
    UserRepository,
  ],
  exports: [LicenseGateService, LegalValueService, Article15DService],
})
export class LicenseGateModule {}
