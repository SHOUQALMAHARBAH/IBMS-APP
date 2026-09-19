import { Injectable } from '@nestjs/common';
import { PermissionRepository } from '../../../repositories/permission.repository';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  codes: string[];
  expiresAt: number;
}

/**
 * Resolves a set of roles to the permission codes they grant.
 *
 * Resolution is always LIVE against `RolePermission` — effective permissions
 * are never snapshotted onto the user or into the JWT, so editing a role takes
 * effect for everyone holding it without anyone re-authenticating. The grid
 * changes rarely (an admin action, not a per-request event), so a short TTL
 * cache avoids a join on every guarded request; `invalidateCache()` makes an
 * admin's own change visible immediately rather than a minute later.
 *
 * ---------------------------------------------------------------------------
 * THE CACHE IS KEYED ON ROLE IDS, NOT ROLE NAMES
 * ---------------------------------------------------------------------------
 * The key used to be `[...roleNames].sort().join(',')`, which was safe only
 * while `Role.name` was globally unique. Under office-scoped custom roles the
 * constraint is `(organizationId, name)`, so two offices can each have a role
 * called "Manager" holding entirely different permissions — and a name-keyed
 * entry written for one office would then be served to the other for up to a
 * minute. Role ids are uuids, unique across every office, so a key built from
 * them cannot collide across tenants by construction.
 *
 * Known limitation, deliberately not solved here: this cache is per-process, so
 * in a multi-instance deployment `invalidateCache()` clears only the instance
 * that handled the write and the others catch up within the TTL. Bounded
 * staleness, never a wrong tenant.
 */
@Injectable()
export class PermissionsService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly permissions: PermissionRepository) {}

  async getCodesForRoles(roleIds: string[]): Promise<Set<string>> {
    if (roleIds.length === 0) return new Set();

    const key = [...roleIds].sort().join(',');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return new Set(cached.codes);
    }

    const codes = await this.permissions.findCodesForRoles(roleIds);
    this.cache.set(key, { codes, expiresAt: Date.now() + CACHE_TTL_MS });
    return new Set(codes);
  }

  /** Called after any admin write to the grid so callers don't wait out
   * the TTL to see their own change take effect. Every write path that can
   * change a role's permissions or a user's role set must call this —
   * role create/edit/deactivate as much as grant/revoke. */
  invalidateCache(): void {
    this.cache.clear();
  }
}
