import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RbacController } from './controllers/rbac.controller';
import { AccessRecertificationController } from './controllers/access-recertification.controller';
import { UserAdminController } from './controllers/user-admin.controller';
import { OrgStructureController } from './controllers/org-structure.controller';
import { PermissionsModule } from './permissions.module';
import { UserAdminService } from './services/user-admin.service';
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

@Module({
  // AuthModule exports UserRepository — reused here (the scheduler needs it
  // to resolve the system service account, and the recertification service
  // needs it to enrich item views with subject name/email/roles) rather
  // than re-provided. SlaModule exports SlaTimerService — AccessRecertification
  // Service.startCycle() starts a quarterly_access_review timer (backlog A.8).
  imports: [AuditModule, AuthModule, SlaModule, PermissionsModule],
  controllers: [
    RbacController,
    AccessRecertificationController,
    UserAdminController,
    OrgStructureController,
  ],
  providers: [
    DepartmentRepository,
    BranchRepository,
    EmployeeRepository,
    UserAdminService,
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
