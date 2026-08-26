import { Injectable } from '@nestjs/common';
import type { RoleName } from '@ibms/db';
import { PermissionRepository } from '../../../repositories/permission.repository';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  codes: string[];
  expiresAt: number;
}

/** Resolves a set of roles to the permission codes they grant. The grid
 * changes rarely (an admin action, not a per-request event), so a short
 * TTL cache — keyed by the requesting role combination — avoids a
 * RolePermission join on every guarded request while still picking up
 * grid edits within a minute. */
@Injectable()
export class PermissionsService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly permissions: PermissionRepository) {}

  async getCodesForRoles(roles: RoleName[]): Promise<Set<string>> {
    if (roles.length === 0) return new Set();

    const key = [...roles].sort().join(',');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return new Set(cached.codes);
    }

    const codes = await this.permissions.findCodesForRoles(roles);
    this.cache.set(key, { codes, expiresAt: Date.now() + CACHE_TTL_MS });
    return new Set(codes);
  }

  /** Called after any admin write to the grid so callers don't wait out
   * the TTL to see their own change take effect. */
  invalidateCache(): void {
    this.cache.clear();
  }
}
