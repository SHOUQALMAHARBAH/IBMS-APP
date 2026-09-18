import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Role, RoleStatus } from '@ibms/db';
import { UserRepository } from '../../../repositories/user.repository';
import { RoleRepository } from '../../../repositories/role.repository';
import { AuditService } from '../../audit/audit.service';
import type { RecordAuditEntryInput } from '../../audit/audit.service';
import { PermissionsService } from './permissions.service';

/**
 * The capability that makes an administrator an administrator: it is what grants
 * roles back, so losing every holder of it is unrecoverable short of direct
 * database access.
 *
 * Kept identical to `UserAdminService`'s constant on purpose — the two services
 * guard the same invariant by different routes and must agree on what
 * "administrator" means. `AccessRecertificationService.getAdminAccessItems`
 * resolves the same capability for the same reason.
 */
const USER_ADMIN_PERMISSION = 'user.manage';

/**
 * Role lifecycle — the office's own roles, administered by the office.
 *
 * ## The third route to the administrator lockout
 *
 * `UserAdminService` already refuses to remove the last holder of `user.manage`
 * two ways: revoking the last grant, and deactivating the last holder.
 * `Role.status` adds a THIRD, and it is the least obvious of the three, because
 * nothing about "retire a role we no longer use" looks like removing anybody's
 * access.
 *
 * All three ask one question — "what still holds `user.manage` after this
 * write?" — and differ only in what they subtract:
 *
 *   revokeRole   one ASSIGNMENT  (this user, this role)
 *   setActive    one USER        (every role they hold)
 *   setStatus    one ROLE        (every user who holds it)
 *
 * All three take the same transaction-scoped advisory lock on
 * (organizationId, `user.manage`), so two of them racing each other — retiring
 * one administrator role while another request revokes the last grant on a
 * different one — serialise rather than both observing a survivor.
 */
@Injectable()
export class RoleAdminService {
  private readonly logger = new Logger(RoleAdminService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Retire or reactivate one of the office's own roles.
   *
   * Retirement is the only removal there is — see `Role.status` in the schema for
   * why there is no delete. Reactivation is deliberately unguarded: it can only
   * add access back, and refusing it would leave an office unable to undo a
   * retirement it regrets.
   */
  async setStatus(
    roleId: string,
    status: RoleStatus,
    actorUserId: string,
  ): Promise<Role> {
    const role = await this.users.findRoleById(roleId);
    if (!role) {
      throw new NotFoundException(`Role ${roleId} not found.`);
    }
    this.assertNotSystem(role, 'retired or reactivated');

    if (status === 'ACTIVE') {
      return this.applyStatus(role, status, actorUserId);
    }

    // Only roles that actually grant the capability are guarded, so retiring
    // anything else stays on the unguarded path and does not contend for the
    // office's administration lock.
    const guarded = await this.users.roleGrantsPermission(
      role.id,
      USER_ADMIN_PERMISSION,
    );
    if (!guarded) {
      return this.applyStatus(role, status, actorUserId);
    }

    return this.users.withCapabilityLocked(USER_ADMIN_PERMISSION, async () => {
      // What would still hold `user.manage` once THIS role is retired: every
      // active holder reached through some other role. `findActiveHoldersOfPermission`
      // already excludes retired roles, so subtracting this one is the whole
      // difference the pending write makes.
      const holders = await this.users.findActiveHoldersOfPermission(
        USER_ADMIN_PERMISSION,
      );
      const remaining = new Set(
        holders.filter((h) => h.roleId !== role.id).map((h) => h.userId),
      );
      if (remaining.size === 0) {
        throw new UnprocessableEntityException(
          'Refusing to retire the last role that grants user administration — nobody would be able to grant it back. Give another role that permission first.',
        );
      }
      return this.applyStatus(role, status, actorUserId);
    });
  }

  /**
   * `isSystem` is a PROTECTION flag and nothing else.
   *
   * It says "the platform defined this row, so the office's own Role screen does
   * not get to change it" — the eleven converted legacy roles and
   * `OFFICE_ADMINISTRATOR`. It is read here and by the other CRUD guards, and by
   * NO authorization code anywhere: holding an isSystem role grants exactly the
   * permissions it was granted and not one thing more. A flag with this name is
   * where an `if (isSystem) allow` bypass would be smuggled in, so its absence
   * has its own test rather than being left to review.
   */
  private assertNotSystem(role: Role, attempted: string): void {
    if (role.isSystem) {
      throw new UnprocessableEntityException(
        `Role ${role.name} is defined by the platform and cannot be ${attempted}. Create your own role instead.`,
      );
    }
  }

  private async applyStatus(
    role: Role,
    status: RoleStatus,
    actorUserId: string,
  ): Promise<Role> {
    const updated = await this.roles.setStatus(role.id, status);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Role',
      entityId: role.id,
      beforeValue: { status: role.status },
      afterValue: { status, name: role.name },
    });
    // Retiring a role changes what its holders can do, and nothing else
    // invalidates the permission cache: `PermissionsService` keys on sorted role
    // IDS and a retirement touches no assignment, so the ids a session resolves
    // are unchanged and the cached answer would stand for up to its 60s TTL.
    //
    // NOTE: `invalidateCache()` clears THIS process's cache. Correct today (the
    // API runs as a single instance) but worth knowing: the moment a second
    // instance exists, a role change is invisible to the other one until its own
    // entry expires.
    this.permissions.invalidateCache();
    return updated;
  }

  /** Logged, not thrown — the status change has already committed, and a signal
   *  that could not be written must not be reported as a failed write. */
  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Failed to write the audit entry for Role ${input.entityId}: ${(err as Error).message}`,
      );
    }
  }
}
