import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationRepository } from '../../repositories/notification.repository';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { PermissionsModule } from '../rbac/permissions.module';

/**
 * Imports `PermissionsModule`, never `RbacModule` — that module imports
 * `AuthModule` and the dependency would be circular. `PermissionsModule` was
 * extracted for exactly this, and its own doc explains why a duplicated
 * provider would be worse than a cycle: `PermissionsService` holds a 60-second
 * cache, and a second instance would miss the admin's `invalidateCache()`.
 */
@Module({
  imports: [PermissionsModule],
  controllers: [NotificationController],
  /** `OrganizationRepository` for decision 131's mark: a code is only «جديدة» for an office if it
   *  arrived AFTER that office's own `createdAt`, so the bell needs the office's row. */
  providers: [
    NotificationService,
    NotificationRepository,
    OrganizationRepository,
  ],
})
export class NotificationModule {}
