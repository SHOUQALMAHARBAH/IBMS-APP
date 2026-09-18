import { Injectable } from '@nestjs/common';
import type { Role } from '@ibms/db';
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
    return this.prisma.client.role.findMany({ orderBy: { name: 'asc' } });
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
  async findActiveUserIdsWithPermission(code: string): Promise<string[]> {
    const grants = await this.prisma.client.rolePermission.findMany({
      where: { permission: { code } },
      select: { roleId: true },
    });
    if (grants.length === 0) return [];

    const roleIds = [...new Set(grants.map((g) => g.roleId))];
    const assignments = await this.prisma.client.userRoleAssignment.findMany({
      where: { revokedAt: null, roleId: { in: roleIds } },
      select: { userId: true },
    });
    return [...new Set(assignments.map((a) => a.userId))];
  }
}
