import { Global, Module } from '@nestjs/common';
import { CombinedDutyActRepository } from '../../repositories/combined-duty-act.repository';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { PermissionRepository } from '../../repositories/permission.repository';
import { DutySegregationService } from './duty-segregation.service';

/**
 * `@Global()`, for the same reason `WorkflowModule` is: nineteen call sites in fourteen modules record a
 * checker decision, and adding an import to all fourteen is a list somebody will forget to extend when the
 * twentieth arrives. The alternative — each module injecting three repositories and calling a free function —
 * puts the mode read, the reason check and the act write in fourteen places, which is exactly what this
 * exists to prevent.
 */
@Global()
@Module({
  providers: [
    DutySegregationService,
    OrganizationRepository,
    PermissionRepository,
    CombinedDutyActRepository,
  ],
  exports: [DutySegregationService],
})
export class DutySegregationModule {}
