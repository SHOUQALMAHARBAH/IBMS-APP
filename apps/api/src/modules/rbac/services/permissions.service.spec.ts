import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionsService } from './permissions.service';
import type { PermissionRepository } from '../../../repositories/permission.repository';

/**
 * Office-scoped custom roles moved permission resolution from role NAME to role
 * ID. These tests cover the multi-role union semantics that nothing in the
 * codebase exercised before (no user in either seeded organization holds more
 * than one role), and the collision that the name-keyed version would have
 * produced once two offices can both name a role "Manager".
 */

/** A repository stub that answers from a roleId -> codes map, and counts calls
 *  so the cache can be observed rather than assumed. */
function repoWith(grid: Record<string, string[]>) {
  const findCodesForRoles = vi.fn((roleIds: string[]): Promise<string[]> =>
    Promise.resolve([...new Set(roleIds.flatMap((id) => grid[id] ?? []))]),
  );
  return {
    repo: { findCodesForRoles } as unknown as PermissionRepository,
    findCodesForRoles,
  };
}

describe('PermissionsService', () => {
  let service: PermissionsService;
  let findCodesForRoles: ReturnType<typeof vi.fn>;

  const GRID = {
    'role-sales': ['lead.create', 'customer.create', 'customer.read'],
    'role-claims': ['claim.register', 'claim.assess', 'customer.read'],
    'role-finance': ['refund.approve'],
    'role-empty': [],
  };

  beforeEach(() => {
    const built = repoWith(GRID);
    findCodesForRoles = built.findCodesForRoles;
    service = new PermissionsService(built.repo);
  });

  // --- Test #1 — one role -------------------------------------------------
  it('resolves exactly the permissions a single role grants', async () => {
    const codes = await service.getCodesForRoles(['role-sales']);
    expect([...codes].sort()).toEqual([
      'customer.create',
      'customer.read',
      'lead.create',
    ]);
    // Nothing from another role leaks in.
    expect(codes.has('claim.register')).toBe(false);
    expect(codes.has('refund.approve')).toBe(false);
  });

  it('grants nothing at all for a user holding no roles, without querying', async () => {
    // A zero-role account is a real, tolerated state — four users in the seeded
    // organization are in it today. It must resolve to an empty set rather than
    // an error, and must not cost a query.
    const codes = await service.getCodesForRoles([]);
    expect(codes.size).toBe(0);
    expect(findCodesForRoles).not.toHaveBeenCalled();
  });

  // --- Test #2 — multiple roles resolve the UNION -------------------------
  it('resolves the union of every role a user holds', async () => {
    const codes = await service.getCodesForRoles([
      'role-sales',
      'role-claims',
      'role-finance',
    ]);
    expect([...codes].sort()).toEqual([
      'claim.assess',
      'claim.register',
      'customer.create',
      'customer.read',
      'lead.create',
      'refund.approve',
    ]);
  });

  it('is unaffected by a role that grants nothing', async () => {
    const withEmpty = await service.getCodesForRoles([
      'role-sales',
      'role-empty',
    ]);
    const without = await service.getCodesForRoles(['role-sales']);
    expect([...withEmpty].sort()).toEqual([...without].sort());
  });

  // --- Test #3 — overlapping permissions ----------------------------------
  it('dedupes a permission two roles both grant', async () => {
    // `customer.read` is in both role-sales and role-claims. A Set makes this
    // structurally true, which is the point: holding it twice is holding it
    // once, so revoking ONE of the two roles must not revoke the permission.
    const codes = await service.getCodesForRoles(['role-sales', 'role-claims']);
    expect([...codes].filter((c) => c === 'customer.read')).toHaveLength(1);

    const afterLosingClaims = await service.getCodesForRoles(['role-sales']);
    expect(afterLosingClaims.has('customer.read')).toBe(true);
    // ...but the permissions only the removed role granted are gone.
    expect(afterLosingClaims.has('claim.assess')).toBe(false);
  });

  it('does not depend on the order the roles are given in', async () => {
    const a = await service.getCodesForRoles(['role-claims', 'role-sales']);
    const b = await service.getCodesForRoles(['role-sales', 'role-claims']);
    expect([...a].sort()).toEqual([...b].sort());
    // And the cache key is order-insensitive too, so the second call was a hit.
    expect(findCodesForRoles).toHaveBeenCalledTimes(1);
  });

  // --- Test #10 (unit half) — the cross-tenant collision ------------------
  it('keeps two offices apart when both name a role the same thing', async () => {
    // THE REGRESSION THIS FILE EXISTS FOR.
    //
    // The cache used to key on `[...roleNames].sort().join(',')` and the
    // repository used to filter `where: { role: { name: { in: roles } } }`.
    // Both were safe only while `Role.name` was globally unique. Under
    // office-scoped custom roles two offices can each define "Manager" with
    // entirely different grants — and a name-keyed lookup returns the UNION of
    // both, cached for a minute.
    //
    // Ids are uuids, unique across every office, so the same name cannot
    // collide. Both roles below are called "Manager".
    const built = repoWith({
      'office-a-manager': ['policy.check'],
      'office-b-manager': ['claim.settle.approve'],
    });
    const svc = new PermissionsService(built.repo);

    const officeA = await svc.getCodesForRoles(['office-a-manager']);
    const officeB = await svc.getCodesForRoles(['office-b-manager']);

    expect([...officeA]).toEqual(['policy.check']);
    expect([...officeB]).toEqual(['claim.settle.approve']);
    // Neither office sees the other's grant — the whole point.
    expect(officeA.has('claim.settle.approve')).toBe(false);
    expect(officeB.has('policy.check')).toBe(false);
    // Two distinct cache entries, so the second call was NOT served the first
    // office's answer.
    expect(built.findCodesForRoles).toHaveBeenCalledTimes(2);
  });

  // --- Cache behaviour ----------------------------------------------------
  it('serves a repeat request from cache rather than re-querying', async () => {
    await service.getCodesForRoles(['role-sales']);
    await service.getCodesForRoles(['role-sales']);
    expect(findCodesForRoles).toHaveBeenCalledTimes(1);
  });

  it('returns a fresh Set each time, so a caller cannot mutate the cache', async () => {
    const first = await service.getCodesForRoles(['role-sales']);
    first.add('refund.approve');
    const second = await service.getCodesForRoles(['role-sales']);
    expect(second.has('refund.approve')).toBe(false);
  });

  it('re-queries after invalidateCache, so a grid edit applies immediately', async () => {
    // Test #5's unit half. Editing a role's permissions must take effect for
    // everyone holding it without waiting out the TTL — which is why every
    // write path that can change the grid has to call this.
    await service.getCodesForRoles(['role-sales']);
    service.invalidateCache();
    await service.getCodesForRoles(['role-sales']);
    expect(findCodesForRoles).toHaveBeenCalledTimes(2);
  });

  it('expires an entry once the TTL has passed', async () => {
    vi.useFakeTimers();
    try {
      await service.getCodesForRoles(['role-sales']);
      vi.advanceTimersByTime(60_001);
      await service.getCodesForRoles(['role-sales']);
      expect(findCodesForRoles).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
