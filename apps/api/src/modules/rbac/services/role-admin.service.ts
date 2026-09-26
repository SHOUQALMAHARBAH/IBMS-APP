import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type Role, type RoleStatus } from '@ibms/db';
import { UserRepository } from '../../../repositories/user.repository';
import { MAKER_CHECKER_REGISTRY } from '../../../common/maker-checker-pairs.config';
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
/**
 * One row of the readiness list: an operation that needs two people, and whether this office has them.
 *
 * `constraint` is carried so the row can be tied back to what actually refuses — the CHECK constraint —
 * rather than only to a label somebody might rename.
 */
export interface DutySegregationReadiness {
  entityType: string;
  pairLabel: string;
  constraint: string | null;
  checkerPermission: string;
  /** Distinct ACTIVE users holding the checker permission. */
  holderCount: number;
  status: 'NOBODY' | 'SINGLE_HOLDER' | 'READY';
}

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

    // THE FOURTH ROUTE to the administrator lockout, and the one the matrix
    // screen opens.
    //
    // The other three are revoking a user's grant and deactivating the user
    // (both Phase 2) and retiring the role. This one is quieter: unchecking
    // `user.manage` on the last role whose holders actually have it leaves the
    // office with nobody who can administer users — and unlike a revoke, nothing
    // about the action looks like it is about access at all.
    //
    // Reachable despite every office having an isSystem `OFFICE_ADMINISTRATOR`
    // that `assertNotSystem` protects: an office with a second, CUSTOM
    // administrator role can have every `OFFICE_ADMINISTRATOR` grant revoked
    // one at a time (each allowed, because the custom role's holders survive
    // each check), and then have the capability removed from that custom role
    // here. The administrator role still GRANTS it; nobody HOLDS it, and nobody
    // can be given it.
    //
    // Guarded exactly like `setStatus`: only when this write actually takes the
    // capability away, under the same per-office advisory lock, asking what
    // survives THIS change rather than what exists now.
    const removesUserAdmin =
      before.has(USER_ADMIN_PERMISSION) && !after.has(USER_ADMIN_PERMISSION);
    if (!removesUserAdmin) {
      return this.applyPermissions(
        roleId,
        organizationId,
        permissionIds,
        before,
        after,
        actorUserId,
      );
    }

    return this.users.withCapabilityLocked(USER_ADMIN_PERMISSION, async () => {
      const holders = await this.users.findActiveHoldersOfPermission(
        USER_ADMIN_PERMISSION,
      );
      const remaining = new Set(
        holders.filter((h) => h.roleId !== roleId).map((h) => h.userId),
      );
      if (remaining.size === 0) {
        throw new UnprocessableEntityException(
          'Refusing to remove user administration from the last role whose holders have it — nobody would be able to grant it back. Give another role that permission, and somebody that role, first.',
        );
      }
      return this.applyPermissions(
        roleId,
        organizationId,
        permissionIds,
        before,
        after,
        actorUserId,
      );
    });
  }

  /** The write half of `setPermissions`, called from both sides of its lockout
   *  guard so the guarded and unguarded paths cannot drift. */
  private async applyPermissions(
    roleId: string,
    organizationId: string,
    permissionIds: string[],
    before: Set<string>,
    after: Set<string>,
    actorUserId: string,
  ): Promise<{ permissionCodes: string[] }> {
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
   * Delete one of the office's own roles.
   *
   * The owner's decision, verbatim in its parts: the role and its effect go immediately, there is no
   * "reassign the users first" gate, and a user left with zero roles and zero permissions is an
   * accepted outcome rather than something to prevent. Permissions resolve from the role at request
   * time, so nothing is copied onto a user that could survive this.
   *
   * It is a SOFT delete — see `RoleRepository.softDelete` and the migration for why the FK makes a
   * hard one impossible without discarding the history she asked to keep.
   *
   * ONE refusal is kept, and it is deliberately NOT a reassignment gate: deleting the last role that
   * grants user administration would leave the office with nobody able to grant it back, and there
   * is no route into the application that repairs that. It is the same guard the other three write
   * paths already carry (retiring a role, unchecking `user.manage` in the matrix, revoking the last
   * grant), under the same per-office lock, so delete cannot slip past a control the other three
   * respect. Losing every permission is recoverable by an administrator; losing every administrator
   * is not.
   */
  async remove(roleId: string, actorUserId: string): Promise<void> {
    const role = await this.users.findRoleById(roleId);
    if (!role) throw new NotFoundException(`Role ${roleId} not found.`);
    if (role.deletedAt) {
      throw new UnprocessableEntityException(
        `Role ${role.name} is already deleted.`,
      );
    }
    this.assertNotSystem(role, 'deleted');

    const guarded = await this.users.roleGrantsPermission(
      role.id,
      USER_ADMIN_PERMISSION,
    );
    if (!guarded) {
      await this.applyRemoval(role, actorUserId);
      return;
    }

    await this.users.withCapabilityLocked(USER_ADMIN_PERMISSION, async () => {
      const holders = await this.users.findActiveHoldersOfPermission(
        USER_ADMIN_PERMISSION,
      );
      const remaining = new Set(
        holders.filter((h) => h.roleId !== role.id).map((h) => h.userId),
      );
      if (remaining.size === 0) {
        throw new UnprocessableEntityException(
          'Refusing to delete the last role that grants user administration — nobody would be able to grant it back. Give another role that permission first.',
        );
      }
      await this.applyRemoval(role, actorUserId);
    });
  }

  /** The write half, called from both sides of the lockout guard so the guarded and unguarded paths
   *  cannot drift — the same shape `setStatus` uses. */
  private async applyRemoval(role: Role, actorUserId: string): Promise<void> {
    const { permissionCodes, assignmentsRevoked } = await this.roles.softDelete(
      role.id,
    );

    await this.safeAudit({
      userId: actorUserId,
      action: 'DELETE',
      entityType: 'Role',
      entityId: role.id,
      // The codes go in the BEFORE value because the grants no longer exist anywhere else: this row
      // is now the only record of what the role could do.
      beforeValue: { name: role.name, permissionCodes },
      afterValue: { deleted: true, assignmentsRevoked },
    });
    // Not optional. Until this runs, a session that resolved this role keeps its permissions for up
    // to the cache TTL — a deletion that takes a minute to bite is the one direction that matters.
    this.permissions.invalidateCache();
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
  /**
   * WHICH OPERATIONS NEEDING TWO PEOPLE CAN THIS OFFICE ACTUALLY COMPLETE?
   *
   * Part 5's first honesty fix. Fifteen operations in this system require a second person by law and by
   * constraint, and an office found that out the way the owner did: by being refused halfway through one.
   * Nothing told anybody in advance, and nothing said which of them the office had nobody able to finish.
   *
   * For each pair this returns the checker permission and how many ACTIVE people hold it —
   * `findActiveHoldersOfPermission` already excludes retired roles and expired access windows, which is
   * the hard-won part. Distinct USERS, not grants: one person holding the code through two roles is one
   * person.
   *
   * Three states, and the middle one is the useful one:
   *
   *   NOBODY         nobody holds the checker permission — the operation cannot be completed at all
   *   SINGLE_HOLDER  exactly one person does — completable only when they are not also the maker
   *   READY          two or more
   *
   * It deliberately does NOT try to say "and therefore you are fine". Whether a specific record can be
   * checked depends on who raised it, which is a per-instance question this cannot answer. What it answers
   * is the office-level one, which is the one nobody could ask before.
   */
  async dutySegregationReadiness(): Promise<DutySegregationReadiness[]> {
    // One lookup per DISTINCT permission, not per pair: two NeedsAssessment pairs share
    // `needs-assessment.approve`, and asking twice would be two identical queries.
    const codes = [
      ...new Set(MAKER_CHECKER_REGISTRY.map((p) => p.checkerPermission)),
    ];
    const holders = new Map<string, number>();
    for (const code of codes) {
      const grants = await this.users.findActiveHoldersOfPermission(code);
      holders.set(code, new Set(grants.map((g) => g.userId)).size);
    }

    return MAKER_CHECKER_REGISTRY.map((pair) => {
      const holderCount = holders.get(pair.checkerPermission) ?? 0;
      return {
        entityType: pair.entityType,
        pairLabel: pair.pairLabel,
        constraint: pair.dbCheckConstraint,
        checkerPermission: pair.checkerPermission,
        holderCount,
        status:
          holderCount === 0
            ? ('NOBODY' as const)
            : holderCount === 1
              ? ('SINGLE_HOLDER' as const)
              : ('READY' as const),
      };
    });
  }
}
