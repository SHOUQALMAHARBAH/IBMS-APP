import { Module } from '@nestjs/common';
import { PermissionsService } from './services/permissions.service';
import { PermissionRepository } from '../../repositories/permission.repository';

/**
 * Part IV §10.4 — the one place that resolves a set of roles to the permission
 * codes they grant.
 *
 * Extracted out of `RbacModule` so `AuthModule` can use it too. It cannot
 * simply import `RbacModule`: that module already imports `AuthModule` (for
 * `UserRepository`), so the dependency would be circular. Duplicating the
 * provider in both modules would compile and would be wrong in a way nobody
 * would notice for a minute at a time — `PermissionsService` holds a 60-second
 * TTL cache, two instances means two caches, and the `invalidateCache()` an
 * admin write triggers would clear only one of them. A revoked permission
 * would keep rendering in that administrator's own UI until the other cache
 * expired.
 *
 * Depends on nothing but a repository, so it sits below both modules and
 * closes the cycle rather than working around it.
 */
@Module({
  providers: [PermissionRepository, PermissionsService],
  exports: [PermissionsService, PermissionRepository],
})
export class PermissionsModule {}
