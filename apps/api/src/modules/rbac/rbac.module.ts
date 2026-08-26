import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RbacController } from './controllers/rbac.controller';
import { AccessRecertificationController } from './controllers/access-recertification.controller';
import { PermissionsService } from './services/permissions.service';
import { AccessRecertificationService } from './services/access-recertification.service';
import { AccessRecertificationScheduler } from './services/access-recertification.scheduler';
import { PermissionsGuard } from './guards/permissions.guard';
import { RoleRepository } from '../../repositories/role.repository';
import { PermissionRepository } from '../../repositories/permission.repository';
import { AccessRecertificationRepository } from '../../repositories/access-recertification.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule exports UserRepository — reused here (the scheduler needs it
  // to resolve the system service account, and the recertification service
  // needs it to enrich item views with subject name/email/roles) rather
  // than re-provided.
  imports: [AuditModule, AuthModule],
  controllers: [RbacController, AccessRecertificationController],
  providers: [
    PermissionsService,
    AccessRecertificationService,
    AccessRecertificationScheduler,
    RoleRepository,
    PermissionRepository,
    AccessRecertificationRepository,
    // Global guard — see permissions.guard.ts. Runs after AuthModule's
    // JwtAuthGuard/MfaRequiredGuard/RolesGuard/StepUpGuard (module import
    // order in AppModule determines global-guard execution order).
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PermissionsService],
})
export class RbacModule {}
