import { Module } from '@nestjs/common';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { EmployeeRepository } from '../../repositories/employee.repository';
import { AuditModule } from '../audit/audit.module';
import { SecurityModule } from '../security/security.module';
import { SlaModule } from '../sla/sla.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Process 66 (backlog Part C #66, Domain H — opens Domain H, Supporting
 * Operations #66-74). Human Resources: `Employee` + licensing/certification
 * tracking + training records (`SecurityAwarenessTraining`) + an automated
 * access de-provisioning checklist (`AccessDeprovisioningChecklist`) on
 * termination. All three models pre-exist in the core schema — this module
 * is their first real consumer. See
 * `ibms-brain/meta/context/employee-onboarding.md`.
 *
 *   - AuditModule    -> AuditService (a CREATE/UPDATE row per write).
 *   - SecurityModule -> EncryptionService / SensitiveFieldRevealService
 *     (`Employee.nationalIdEnc`'s field-level encryption + masked-by-
 *     default reveal, the `CustomerModule` shape).
 *   - SlaModule       -> SlaTimerService (`termination_access_revocation`,
 *     already registered in `SLA_REGISTRY` with zero prior caller —
 *     `EmployeeService.terminate()` is its first).
 *   - AuthModule      -> UserRepository (validating/linking an optional
 *     `User.employeeId`) + SessionService (killing live sessions the
 *     moment `systemAccessRevoked` is actually ticked).
 *
 * No new permission, no migration — `employee.manage` / `training.record` /
 * `deprovisioning.execute` were all pre-seeded ahead of time, the Domain G
 * "seed before code" precedent extended to Domain H.
 */
@Module({
  imports: [AuditModule, SecurityModule, SlaModule, AuthModule],
  controllers: [EmployeeController],
  providers: [EmployeeService, EmployeeRepository],
})
export class EmployeeModule {}
