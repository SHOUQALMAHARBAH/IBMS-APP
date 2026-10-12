import { Module } from '@nestjs/common';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { APP_GUARD } from '@nestjs/core';
import { RbacController } from './controllers/rbac.controller';
import { AccessRecertificationController } from './controllers/access-recertification.controller';
import { UserAdminController } from './controllers/user-admin.controller';
import { OrgStructureController } from './controllers/org-structure.controller';
import { PermissionsModule } from './permissions.module';
import { UserAdminService } from './services/user-admin.service';
import { RoleAdminService } from './services/role-admin.service';
import { OrgStructureService } from './services/org-structure.service';
import { AccessRecertificationService } from './services/access-recertification.service';
import { AccessRecertificationScheduler } from './services/access-recertification.scheduler';
import { PermissionsGuard } from './guards/permissions.guard';
import { RoleRepository } from '../../repositories/role.repository';
import { AccessRecertificationRepository } from '../../repositories/access-recertification.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SlaModule } from '../sla/sla.module';
import { DepartmentRepository } from '../../repositories/department.repository';
import { BranchRepository } from '../../repositories/branch.repository';
import { EmployeeRepository } from '../../repositories/employee.repository';
import { SecurityModule } from '../security/security.module';
import { InsuranceLineRepository } from '../../repositories/insurance-line.repository';

@Module({
  // AuthModule exports UserRepository — reused here (the scheduler needs it
  // to resolve the system service account, and the recertification service
  // needs it to enrich item views with subject name/email/roles) rather
  // than re-provided. SlaModule exports SlaTimerService — AccessRecertification
  // Service.startCycle() starts a quarterly_access_review timer (backlog A.8).
  imports: [
    AuditModule,
    AuthModule,
    SlaModule,
    PermissionsModule,
    // EncryptionService — the paired person-and-account create encrypts the national ID before
    // opening its transaction. PrismaService needs no import: PrismaModule is @Global().
    SecurityModule,
  ],
  controllers: [
    RbacController,
    AccessRecertificationController,
    UserAdminController,
    OrgStructureController,
  ],
  providers: [
    // Module 0 item (j)'s gap closure — the PLATFORM-scope refusal reads the office's type.
    OrganizationRepository,
    // Module 0 item (h). A missing provider is a RUNTIME DI failure `tsc` cannot see —
    // item (e) shipped exactly that — so it lands in the SAME commit as the dependency.
    InsuranceLineRepository,
    DepartmentRepository,
    BranchRepository,
    EmployeeRepository,
    UserAdminService,
    RoleAdminService,
    OrgStructureService,
    AccessRecertificationService,
    AccessRecertificationScheduler,
    RoleRepository,
    AccessRecertificationRepository,
    // Global guard — see permissions.guard.ts. Runs after AuthModule's
    // JwtAuthGuard/MfaRequiredGuard/StepUpGuard (module import
    // order in AppModule determines global-guard execution order).
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PermissionsModule],
})
export class RbacModule {}
