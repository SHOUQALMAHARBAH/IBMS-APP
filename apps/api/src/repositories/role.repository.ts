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
   * Active (non-revoked) user ids currently holding a named role, within the
   * caller's own office.
   *
   * Resolves the role to an ID FIRST and then filters assignments on `roleId`,
   * rather than filtering `role: { name }` in a nested relation clause as this
   * used to. Two reasons:
   *
   *  - A role name identifies a role only within one office now. The extension
   *    scopes the top-level `UserRoleAssignment` query, but a NESTED relation
   *    filter is not something it rewrites — so `role: { name }` would have
   *    matched on a name belonging to any office and leaned on assignment rows
   *    never pointing across an organization to stay correct. That invariant
   *    holds, but an authorization query should not depend on one it cannot see.
   *  - An office may simply not define the role. Returning `[]` explicitly is
   *    clearer than an empty join, and it is a real case: the reviewer-pool
   *    lookups in `AccessRecertificationService` ask for roles that
   *    `demo-office-b`, for one, does not have.
   */
  async findActiveUserIdsByRoleName(roleName: string): Promise<string[]> {
    const role = await this.prisma.client.role.findFirst({
      where: { name: roleName },
      select: { id: true },
    });
    if (!role) return [];
    const assignments = await this.prisma.client.userRoleAssignment.findMany({
      where: { revokedAt: null, roleId: role.id },
      select: { userId: true },
    });
    return assignments.map((a) => a.userId);
  }
}
