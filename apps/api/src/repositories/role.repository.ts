import { Injectable } from '@nestjs/common';
import type { Role, RoleStatus } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every role defined by the CALLER'S OWN office.
   *
   * Office-scoped since `Role` gained `organizationId`: the model is now in
   * `TENANT_SCOPED_MODELS` (derived from the DMMF), so `tenantScopeExtension`
   * injects the organization and this can no longer enumerate another office's
   * roles. Nothing about this method body had to change for that — which is the
   * point of deriving the scoped set from the schema rather than a hand list.
   */
  findAll(): Promise<Role[]> {
    // Deleted roles are excluded everywhere they could be OFFERED. The grant dropdown reads this,
    // and offering a role the office deleted would let someone grant a row that grants nothing.
    return this.prisma.client.role.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * The catalogue as the Role screen needs it: every role the office has,
   * RETIRED ONES INCLUDED, with enough context to decide what to do next.
   *
   * Deliberately unfiltered on `status` — unlike every query that decides access.
   * A screen that hid retired roles would leave an office unable to reactivate
   * one, which is the only way back from a retirement.
   *
   * The counts are what make a destructive action informed: `holderCount` is how
   * many people lose access if this role is retired, and it excludes revoked
   * grants because those are history rather than access.
   */
  async findAllForAdmin(): Promise<
    (Role & { holderCount: number; permissionCount: number })[]
  > {
    const roles = await this.prisma.client.role.findMany({
      // Retired roles stay — an office must be able to reactivate one. DELETED roles do not: delete
      // is one-way, the row survives only to hold the history, and showing it would offer a
      // reactivate control that the CHECK constraint refuses.
      where: { deletedAt: null },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            users: { where: { revokedAt: null } },
            permissions: true,
          },
        },
      },
    });
    return roles.map(({ _count, ...role }) => ({
      ...role,
      holderCount: _count.users,
      permissionCount: _count.permissions,
    }));
  }

  /** One role of the caller's own office with the permission CODES it grants —
   *  the shape the matrix screen loads to render a row's checkboxes. */
  async findByIdWithPermissionCodes(
    id: string,
  ): Promise<(Role & { permissionCodes: string[] }) | null> {
    const role = await this.prisma.client.role.findFirst({
      where: { id },
      include: {
        permissions: { select: { permission: { select: { code: true } } } },
      },
    });
    if (!role) return null;
    const { permissions, ...rest } = role;
    return {
      ...rest,
      permissionCodes: permissions.map((p) => p.permission.code).sort(),
    };
  }

  /**
   * Create a role with its initial grants, in ONE transaction.
   *
   * `organizationId` is named explicitly on every nested `RolePermission` rather
   * than left to the column default. Phase 1's composite FK
   * `(roleId, organizationId)` -> `Role(id, organizationId)` rejects a grant that
   * disagrees with its role, and the default (`current_setting('app.current_org_id')`)
   * is NULL outside a scoped request — so omitting it turns a silent
   * mis-attribution into a loud FK violation, which is the right failure but not
   * one worth relying on.
   */
  async createWithPermissions(input: {
    organizationId: string;
    name: string;
    nameAr: string;
    nameEn: string;
    description?: string | null;
    permissionIds: string[];
  }): Promise<Role> {
    return this.prisma.client.role.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        description: input.description ?? null,
        permissions: {
          create: input.permissionIds.map((permissionId) => ({
            organizationId: input.organizationId,
            permissionId,
          })),
        },
      },
    });
  }

  /** Display fields only. The machine `name` is included because an office
   *  renames its own roles; the unique constraint is `(organizationId, name)`, so
   *  a collision surfaces as P2002 and the service turns it into a 422. */
  update(
    id: string,
    data: {
      name?: string;
      nameAr?: string;
      nameEn?: string;
      description?: string | null;
    },
  ): Promise<Role> {
    return this.prisma.client.role.update({ where: { id }, data });
  }

  /** The two Part II §4.4 / Part 10.1 security attributes. Separate from
   *  `update` because the route that changes them is separate: it requires a
   *  fresh step-up challenge, and folding it into an ordinary rename would force
   *  a re-authentication for editing a label. */
  setSecurityAttributes(
    id: string,
    data: { requiresMfaAlways?: boolean; requiresHardwareToken?: boolean },
  ): Promise<Role> {
    return this.prisma.client.role.update({ where: { id }, data });
  }

  /**
   * REPLACE a role's grants with exactly this set, in one transaction.
   *
   * Replacement rather than a delta, because the matrix screen submits the state
   * it believes is true. Reconciling a delta against what the server actually has
   * would silently merge two administrators' intentions; replacing makes the
   * second save the last writer, which is a behaviour someone can reason about.
   */
  async replacePermissions(
    roleId: string,
    organizationId: string,
    permissionIds: string[],
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            organizationId,
            roleId,
            permissionId,
          })),
        });
      }
    });
  }

  /**
   * Delete a role: the office's view of it ends, and the record of who held it does not.
   *
   * A SOFT delete, and not by preference. `UserRoleAssignment.roleId` is ON DELETE RESTRICT
   * (measured), so a hard delete fails the moment anyone holds the role — the only case that
   * matters — and loosening that FK would trade the owner's decision for the mechanism: CASCADE
   * destroys the history she asked to keep, SET NULL keeps rows that no longer name the role.
   *
   * Three writes, one transaction:
   *
   *  1. The `RolePermission` rows are DELETED. This is what makes the effect vanish structurally
   *     rather than by filtering — there are fourteen Role/assignment read sites in these
   *     repositories, and a design that needed all fourteen to remember `deletedAt` is the shape
   *     that has bitten this codebase before. Nothing to resolve means nothing resolves.
   *  2. Every live `UserRoleAssignment` is marked `revokedAt` — the history survives, still naming
   *     the role, exactly as the owner decided. Rows already revoked keep their original timestamp;
   *     overwriting them would rewrite when someone actually lost access.
   *  3. The role is stamped `deletedAt` and forced INACTIVE (a CHECK constraint holds that pair, so
   *     a deleted role can never be reactivated back into service).
   *
   * Returns what it removed, so the caller can write the codes into the audit row — deleting the
   * grants means this is the last moment anything knows what the role could do.
   */
  async softDelete(
    roleId: string,
  ): Promise<{ permissionCodes: string[]; assignmentsRevoked: number }> {
    return this.prisma.client.$transaction(async (tx) => {
      const grants = await tx.rolePermission.findMany({
        where: { roleId },
        select: { permission: { select: { code: true } } },
      });
      await tx.rolePermission.deleteMany({ where: { roleId } });
      const revoked = await tx.userRoleAssignment.updateMany({
        where: { roleId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.role.update({
        where: { id: roleId },
        data: { deletedAt: new Date(), status: 'INACTIVE' },
      });
      return {
        permissionCodes: grants.map((g) => g.permission.code).sort(),
        assignmentsRevoked: revoked.count,
      };
    });
  }

  /**
   * Active (non-revoked) user ids holding ANY role that grants `code`, within
   * the caller's own office.
   *
   * The answer to "who in this office can do X", which is what a reviewer pool
   * and a last-administrator guard actually need. This replaced a
   * `findActiveUserIdsByRoleName`: asking by role NAME cannot answer that
   * question once an office defines its own roles, and that method had no other
   * caller once both of those switched over.
   *
   * ## The tenant trap this is written around
   *
   * `tenantScopeExtension` scopes the TOP-LEVEL model of a query, and only for
   * models carrying `organizationId`. It does not rewrite nested relation
   * filters. So the org-scoped step here is the `RolePermission` read — that
   * model carries `organizationId` (Phase 2 of the office-scoped rework added
   * it, after an RLS policy that joined through `Role` turned out to be
   * unsatisfiable and locked every user out of everything).
   *
   * The one nested filter is `permission: { code }`, and it is safe by design
   * rather than by luck: `Permission` is a deliberately GLOBAL catalogue with no
   * organization at all, so there is no other office's row for it to match.
   *
   * Getting this wrong fails SILENTLY EMPTY — a reviewer pool with nobody in it,
   * a cycle that recertifies nothing and reports success — which is why
   * `tenant-isolation.e2e-spec.ts` covers it with two offices that each define a
   * role of the same name granting the same code.
   */
  /** Retire or reactivate one role. `updateMany`-free because the caller has
   *  already resolved the row on the scoped client, so the id is known to belong
   *  to this office. */
  setStatus(id: string, status: RoleStatus): Promise<Role> {
    return this.prisma.client.role.update({ where: { id }, data: { status } });
  }

  async findActiveUserIdsWithPermission(code: string): Promise<string[]> {
    const grants = await this.prisma.client.rolePermission.findMany({
      // ACTIVE only: a recertification reviewer pool or an administrator-subject
      // report built from a retired role would name people who can no longer do
      // the thing the report is about.
      where: { permission: { code }, role: { status: 'ACTIVE' } },
      select: { roleId: true },
    });
    if (grants.length === 0) return [];

    const roleIds = [...new Set(grants.map((g) => g.roleId))];
    // ORDERED, and the order is load-bearing rather than cosmetic.
    //
    // `AccessRecertificationService.pickReviewer` takes the FIRST member of this list that
    // is not the subject, and README describes that as "always picks the first eligible
    // member of the pool". Without an `orderBy` there is no first member: Postgres returns
    // rows in whatever order the plan produces, and the plan changes with the table's size
    // and statistics. So "the first eligible reviewer" named something that did not exist,
    // and which reviewer a subject got was unspecified — on a segregation-of-duties control.
    //
    // Measured, and this is how it surfaced: `rbac.e2e-spec.ts`'s "not this item's assigned
    // reviewer" test asserts that the earlier-created of two Compliance Officers is the one
    // picked. It passed for months against a test database holding 46,153 users and failed
    // the moment that database was reset to 23 — same code, different plan. A test that
    // depends on an unspecified order is a test that reports the plan, not the behaviour.
    //
    // `grantedAt` then `userId`: the longest-standing eligible reviewer, with a total order
    // so two grants in the same millisecond still resolve the same way every time. That is a
    // RULE someone can state, which is the property the old code lacked — it is still not
    // round-robin, and the README gap about that stands unchanged.
    const assignments = await this.prisma.client.userRoleAssignment.findMany({
      where: { revokedAt: null, roleId: { in: roleIds } },
      select: { userId: true },
      orderBy: [{ grantedAt: 'asc' }, { userId: 'asc' }],
    });
    // `Set` preserves insertion order, so the dedupe keeps the ordering above.
    return [...new Set(assignments.map((a) => a.userId))];
  }
}
