import { Injectable } from '@nestjs/common';
import { PermissionRepository } from '../../../repositories/permission.repository';
import type { RoleScope } from '../../../common/role-scope';
import { isMarkedNew } from '../new-permission-mark.config';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  codes: string[];
  expiresAt: number;
}

/** Module 0 item (h). Cached on the SAME key and TTL as the codes — a scope that went
 *  stale at a different rate from the grants it scopes would be two answers about one role. */
interface ScopeCacheEntry {
  scopes: RoleScope[];
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
 *
 * Phase 3 changed how often that limitation can be reached, without changing the
 * limitation itself. Editing a role used to mean editing the seed and
 * redeploying; it is now a button on `/settings/roles`, so an administrator can
 * grant a permission and watch a colleague on another instance still be refused
 * for up to `CACHE_TTL_MS`. Correct today — the API runs as a single instance —
 * and written down here rather than discovered during the deployment that adds
 * the second one. The fix when that day comes is a shared invalidation channel
 * (Redis pub/sub or a `Role.updatedAt` the cache compares against), not a shorter
 * TTL: a shorter TTL narrows the window without closing it and costs a join on
 * every guarded request.
 */
@Injectable()
export class PermissionsService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly scopeCache = new Map<string, ScopeCacheEntry>();

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

  /**
   * MODULE 0 ITEM (h) — the scopes these roles carry.
   *
   * An EMPTY array means unrestricted, which is also what no roles at all means — see
   * `common/role-scope.ts` for why that reading is the only backward-compatible one.
   */
  async getScopesForRoles(roleIds: string[]): Promise<RoleScope[]> {
    if (roleIds.length === 0) return [];

    const key = [...roleIds].sort().join(',');
    const cached = this.scopeCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.scopes;

    const rows = await this.permissions.findScopesForRoles(roleIds);
    // Only the roles that actually CARRY a scope. A role with no category and no branches is
    // unrestricted, and keeping it would make `roleScopes.length === 0` — the "nobody is scoped"
    // fast path the decision relies on — unreachable for every office in the system.
    const scopes = rows.filter(
      (r) => r.category !== null || r.lineIds.length > 0,
    );
    this.scopeCache.set(key, { scopes, expiresAt: Date.now() + CACHE_TTL_MS });
    return scopes;
  }

  /**
   * OWNER DECISION 131 — the catalogue as THIS office sees it, each code carrying its mark.
   *
   * ⛔ NOT CACHED, deliberately, and the reason is the opposite of the one above. The code cache
   * exists because resolving a caller's grants happens on every guarded request; this runs when
   * somebody opens the permission matrix or loads the bell, which is rare — and its inputs
   * include a grant that an administrator has JUST made. Serving a minute-old answer here would
   * show the mark still on a code they had already decided, which is the one thing criterion 4
   * is about.
   */
  async findAllForOffice(
    officeId: string,
    officeCreatedAt: Date,
  ): Promise<{ code: string; isNew: boolean }[]> {
    const rows = await this.permissions.findMarkStateForOffice(officeId);
    return rows.map((row) => ({
      code: row.code,
      isNew: isMarkedNew({
        introducedAt: row.introducedAt,
        officeCreatedAt,
        grantedHere: row.grantedHere,
        dismissedHere: row.dismissedHere,
      }),
    }));
  }

  /** The codes this office has not yet dealt with — what the bell derives its item from. */
  async markedCodesForOffice(
    officeId: string,
    officeCreatedAt: Date,
  ): Promise<string[]> {
    const rows = await this.findAllForOffice(officeId, officeCreatedAt);
    return rows.filter((r) => r.isNew).map((r) => r.code);
  }

  /** Called after any admin write to the grid so callers don't wait out
   * the TTL to see their own change take effect. Every write path that can
   * change a role's permissions or a user's role set must call this —
   * role create/edit/deactivate as much as grant/revoke. */
  invalidateCache(): void {
    this.cache.clear();
    // Item (h): BOTH caches, always. A scope surviving an invalidation that cleared the
    // codes would leave a role granting one set and scoped by another for up to the TTL.
    this.scopeCache.clear();
  }
}
