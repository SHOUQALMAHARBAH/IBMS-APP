import { Injectable } from '@nestjs/common';
import type { Permission } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The whole permission catalogue.
   *
   * `Permission` is deliberately GLOBAL — it describes what the software can
   * do, which is identical for every office — so this is intentionally not
   * tenant-scoped and every office's role screen reads all of it. Only the
   * GRANTS (`RolePermission`) are per-office.
   */
  findAll(): Promise<Permission[]> {
    return this.prisma.client.permission.findMany({
      orderBy: { code: 'asc' },
    });
  }

  /** The catalogue rows for a set of codes. Returns FEWER than asked for when a
   *  code is unknown, which is how `RoleAdminService` detects one without ever
   *  guessing at what the caller meant. */
  findByCodes(codes: string[]): Promise<Permission[]> {
    if (codes.length === 0) return Promise.resolve([]);
    return this.prisma.client.permission.findMany({
      where: { code: { in: codes } },
    });
  }

  /**
   * Every distinct permission code granted to any of the given roles.
   *
   * ---------------------------------------------------------------------------
   * TAKES ROLE IDS, NEVER ROLE NAMES — THIS IS A TENANT-ISOLATION BOUNDARY
   * ---------------------------------------------------------------------------
   * This used to filter `where: { role: { name: { in: roles } } }`, which was
   * safe only for as long as `Role.name` was globally unique. Office-scoped
   * custom roles removed that: the constraint is now `(organizationId, name)`,
   * so two offices can each define a role called "Manager" with completely
   * different grants.
   *
   * A name filter would have matched BOTH rows and returned the UNION of their
   * permissions — one office silently acquiring another's access, cached for up
   * to a minute by `PermissionsService`. Role ids are uuids and unique across
   * every office, so the same query can no longer cross a tenant boundary even
   * if a caller passes an id it should not have.
   *
   * Callers must source the ids from the actor's own `UserRoleAssignment` rows
   * (which are themselves tenant-scoped), never from client input.
   *
   * ---------------------------------------------------------------------------
   * A RETIRED ROLE GRANTS NOTHING, AND THIS IS WHERE THAT IS TRUE
   * ---------------------------------------------------------------------------
   * `Role.status` is not a screen affordance. This method is the authorization
   * path — every `@RequirePermissions` gate and every cross-owner visibility rule
   * resolves through it — so an INACTIVE role that still matched here would keep
   * granting everything it ever granted, and retiring a role would be a button
   * that appears to work and does nothing.
   *
   * The status filter is a NESTED relation clause, which `tenantScopeExtension`
   * does not rewrite. That is safe here rather than lucky: the top-level
   * `RolePermission` read is already org-scoped by the extension, and Phase 1's
   * composite FK `(roleId, organizationId)` -> `Role(id, organizationId)` makes it
   * impossible for a grant to point at another office's role, so the join cannot
   * reach outside the caller's own office to find an ACTIVE row.
   */
  async findCodesForRoles(roleIds: string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const links = await this.prisma.client.rolePermission.findMany({
      where: { roleId: { in: roleIds }, role: { status: 'ACTIVE' } },
      select: { permission: { select: { code: true } } },
    });
    return [...new Set(links.map((l) => l.permission.code))];
  }
}
