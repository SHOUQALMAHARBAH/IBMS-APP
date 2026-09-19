import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type Role, type RoleStatus } from '@ibms/db';
import { UserRepository } from '../../../repositories/user.repository';
import { RoleRepository } from '../../../repositories/role.repository';
import { PermissionRepository } from '../../../repositories/permission.repository';
import { OrgContextService } from '../../../common/org-context/org-context.service';
import { AuditService } from '../../audit/audit.service';
import type { RecordAuditEntryInput } from '../../audit/audit.service';
import { PermissionsService } from './permissions.service';
import type {
  CreateRoleDto,
  RoleSecurityAttributesDto,
  UpdateRoleDto,
} from '../dto/role-crud.dto';

/** What the Role screen renders for one row. */
export interface RoleAdminView {
  id: string;
  name: string;
  nameAr: string;
  nameEn: string;
  description: string | null;
  status: RoleStatus;
  isSystem: boolean;
  requiresMfaAlways: boolean;
  requiresHardwareToken: boolean;
  /** How many people lose access if this role is retired. Revoked grants are
   *  history, not access, and are excluded. */
  holderCount: number;
  permissionCount: number;
}

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
    private readonly catalogue: PermissionRepository,
    private readonly orgContext: OrgContextService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Every role the office has, retired ones included — a screen that hid them
   *  would leave an office unable to reactivate one. */
  async list(): Promise<RoleAdminView[]> {
    const roles = await this.roles.findAllForAdmin();
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      nameAr: role.nameAr,
      nameEn: role.nameEn,
      description: role.description,
      status: role.status,
      isSystem: role.isSystem,
      requiresMfaAlways: role.requiresMfaAlways,
      requiresHardwareToken: role.requiresHardwareToken,
      holderCount: role.holderCount,
      permissionCount: role.permissionCount,
    }));
  }

  /** One role plus the codes it grants — what the matrix loads to render a row's
   *  checkboxes. Another office's id reads as absent, not forbidden. */
  async get(
    roleId: string,
  ): Promise<RoleAdminView & { permissionCodes: string[] }> {
    const role = await this.roles.findByIdWithPermissionCodes(roleId);
    if (!role) throw new NotFoundException(`Role ${roleId} not found.`);
    const counts = await this.roles.findAllForAdmin();
    const withCounts = counts.find((r) => r.id === role.id);
    return {
      id: role.id,
      name: role.name,
      nameAr: role.nameAr,
      nameEn: role.nameEn,
      description: role.description,
      status: role.status,
      isSystem: role.isSystem,
      requiresMfaAlways: role.requiresMfaAlways,
      requiresHardwareToken: role.requiresHardwareToken,
      holderCount: withCounts?.holderCount ?? 0,
      permissionCount: role.permissionCodes.length,
      permissionCodes: role.permissionCodes,
    };
  }

  async create(dto: CreateRoleDto, actorUserId: string): Promise<Role> {
    const organizationId = this.requireOrganization();
    const permissionIds = await this.resolveCodes(dto.permissionCodes);
    let role: Role;
    try {
      role = await this.roles.createWithPermissions({
        organizationId,
        name: dto.name,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        description: dto.description ?? null,
        permissionIds,
      });
    } catch (err) {
      throw this.asNameCollision(err, dto.name);
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'Role',
      entityId: role.id,
      afterValue: {
        name: role.name,
        nameAr: role.nameAr,
        nameEn: role.nameEn,
        // The codes, not a count: this row is the only record of what the office
        // decided a new role may do.
        permissionCodes: [...dto.permissionCodes].sort(),
      },
    });
    // A brand-new role grants nothing to anybody yet, but the cache is keyed on
    // sorted role ids and invalidating is free — doing it here keeps one rule
    // ("every Role write invalidates") rather than a list of exceptions.
    this.permissions.invalidateCache();
    return role;
  }

  async update(
    roleId: string,
    dto: UpdateRoleDto,
    actorUserId: string,
  ): Promise<Role> {
    const role = await this.users.findRoleById(roleId);
    if (!role) throw new NotFoundException(`Role ${roleId} not found.`);
    this.assertNotSystem(role, 'renamed or edited');

    let updated: Role;
    try {
      updated = await this.roles.update(roleId, {
        name: dto.name,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        description: dto.description,
      });
    } catch (err) {
      throw this.asNameCollision(err, dto.name ?? role.name);
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Role',
      entityId: roleId,
      beforeValue: {
        name: role.name,
        nameAr: role.nameAr,
        nameEn: role.nameEn,
        description: role.description,
      },
      afterValue: {
        name: updated.name,
        nameAr: updated.nameAr,
        nameEn: updated.nameEn,
        description: updated.description,
      },
    });
    // Renaming grants nothing new, but `/auth/me` returns role NAMES for display
    // and those are resolved alongside the cached codes.
    this.permissions.invalidateCache();
    return updated;
  }

  /**
   * Replace a role's grants with exactly this set.
   *
   * The audit row names which codes MOVED, not that "permissions changed": that
   * diff is the only record of when an office widened a role, and it is the first
   * thing an auditor asks for.
   */
  async setPermissions(
    roleId: string,
    permissionCodes: string[],
    actorUserId: string,
  ): Promise<{ permissionCodes: string[] }> {
    const organizationId = this.requireOrganization();
    const role = await this.roles.findByIdWithPermissionCodes(roleId);
    if (!role) throw new NotFoundException(`Role ${roleId} not found.`);
    this.assertNotSystem(role, 're-granted');

    const requested = [...new Set(permissionCodes)];
    const permissionIds = await this.resolveCodes(requested);
    const before = new Set(role.permissionCodes);
    const after = new Set(requested);

    await this.roles.replacePermissions(roleId, organizationId, permissionIds);

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RolePermission',
      entityId: roleId,
      beforeValue: { permissionCodes: [...before].sort() },
      afterValue: {
        permissionCodes: [...after].sort(),
        added: [...after].filter((c) => !before.has(c)).sort(),
        removed: [...before].filter((c) => !after.has(c)).sort(),
      },
    });
    // The one place this is not optional: without it a permission the office just
    // removed keeps working for up to the cache's 60-second TTL, because the
    // role ids a session resolves are unchanged.
    this.permissions.invalidateCache();
    return { permissionCodes: [...after].sort() };
  }

  /**
   * The two security attributes, behind a fresh step-up challenge at the route.
   *
   * Both default to the STRICT value on `Role`, so a role nobody classified is
   * strict — relaxing one is a deliberate act that weakens a control, and the
   * audit row names who did it, to which role, and in which direction.
   */
  async setSecurityAttributes(
    roleId: string,
    dto: RoleSecurityAttributesDto,
    actorUserId: string,
  ): Promise<Role> {
    const role = await this.users.findRoleById(roleId);
    if (!role) throw new NotFoundException(`Role ${roleId} not found.`);
    this.assertNotSystem(role, 'changed');

    const updated = await this.roles.setSecurityAttributes(roleId, {
      requiresMfaAlways: dto.requiresMfaAlways,
      requiresHardwareToken: dto.requiresHardwareToken,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RoleSecurityAttributes',
      entityId: roleId,
      beforeValue: {
        requiresMfaAlways: role.requiresMfaAlways,
        requiresHardwareToken: role.requiresHardwareToken,
      },
      afterValue: {
        name: role.name,
        requiresMfaAlways: updated.requiresMfaAlways,
        requiresHardwareToken: updated.requiresHardwareToken,
        // Named explicitly so an alert can key on it rather than diffing the two
        // objects: a RELAXATION is the direction worth noticing.
        relaxed:
          (role.requiresMfaAlways && !updated.requiresMfaAlways) ||
          (role.requiresHardwareToken && !updated.requiresHardwareToken),
      },
    });
    this.permissions.invalidateCache();
    return updated;
  }

  /** Codes -> ids, refusing the whole request if any code is unknown. A silently
   *  dropped code would grant a role less than the screen showed. */
  private async resolveCodes(codes: string[]): Promise<string[]> {
    if (codes.length === 0) return [];
    const wanted = [...new Set(codes)];
    const found = await this.catalogue.findByCodes(wanted);
    if (found.length !== wanted.length) {
      const known = new Set(found.map((p) => p.code));
      throw new UnprocessableEntityException(
        `Unknown permission code(s): ${wanted.filter((c) => !known.has(c)).join(', ')}.`,
      );
    }
    return found.map((p) => p.id);
  }

  /** The Role screen always runs inside a request, so this is a real invariant
   *  rather than padding: without an Organization a create would fall back to the
   *  column default, which is NULL outside a scoped request. */
  private requireOrganization(): string {
    const organizationId = this.orgContext.currentOrNull();
    if (!organizationId) {
      throw new Error('Role administration requires an Organization context.');
    }
    return organizationId;
  }

  /** `@@unique([organizationId, name])` — two offices may both have a "Manager",
   *  one office may not. Without this the collision surfaces as a Prisma P2002 and
   *  the caller sees a 500 for what is an ordinary, correctable mistake. */
  private asNameCollision(err: unknown, name: string): unknown {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new UnprocessableEntityException(
        `This office already has a role named ${name}.`,
      );
    }
    return err;
  }

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
