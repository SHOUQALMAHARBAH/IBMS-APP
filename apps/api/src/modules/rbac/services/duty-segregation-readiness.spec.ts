import { describe, expect, it, vi } from 'vitest';
import { RoleAdminService } from './role-admin.service';
import { MAKER_CHECKER_REGISTRY } from '../../../common/maker-checker-pairs.config';
import type { UserRepository } from '../../../repositories/user.repository';
import type { RoleRepository } from '../../../repositories/role.repository';
import type { PermissionRepository } from '../../../repositories/permission.repository';
import type { OrgContextService } from '../../../common/org-context/org-context.service';
import type { AuditService } from '../../audit/audit.service';
import type { PermissionsService } from './permissions.service';

/**
 * THE THREE STATES, CONSTRUCTED — because the seeded office cannot produce one of them.
 *
 * The e2e for this endpoint asserts the gate and the shape against db-test, and it holds a conditional
 * assertion for the zero-holder case that NEVER RUNS there: every checker permission in the seeded office
 * is held by somebody. Planting `holderCount === 0 ? NOBODY` out of the service left the whole e2e green
 * (IMPROVEMENTS § 1.51(d), third occurrence), because the fixture cannot reach the branch.
 *
 * So the mapping is proven here, where the holder counts are the test's own input: 0, 1 and 2 all appear,
 * and each has to produce its own status.
 */
function makeService(holdersByCode: Record<string, number>) {
  const users = {
    findActiveHoldersOfPermission: vi.fn((code: string) => {
      const n = holdersByCode[code] ?? 0;
      // The repository returns one row per (user, role) GRANT, so the service has to count distinct users.
      // Two rows for one user is the case that would otherwise inflate the count.
      return Promise.resolve(
        Array.from({ length: n }, (_, i) => ({
          userId: `u-${code}-${i}`,
          roleId: `r-${i}`,
        })),
      );
    }),
  };
  const service = new RoleAdminService(
    users as unknown as UserRepository,
    {} as unknown as RoleRepository,
    {} as unknown as PermissionRepository,
    {} as unknown as OrgContextService,
    {} as unknown as AuditService,
    {} as unknown as PermissionsService,
  );
  return { service, users };
}

describe('duty-segregation readiness', () => {
  it('maps 0 holders to NOBODY, 1 to SINGLE_HOLDER and 2+ to READY', async () => {
    const { service } = makeService({
      'refund.approve': 0,
      'policy.check': 1,
      'kyc.approve': 5,
    });
    const rows = await service.dutySegregationReadiness();

    const byPermission = new Map(rows.map((r) => [r.checkerPermission, r]));
    expect(byPermission.get('refund.approve')?.status).toBe('NOBODY');
    expect(byPermission.get('policy.check')?.status).toBe('SINGLE_HOLDER');
    expect(byPermission.get('kyc.approve')?.status).toBe('READY');
    // A permission nobody was configured for reads as NOBODY rather than being omitted: a missing row
    // would be an operation nobody is told about.
    expect(byPermission.get('dpa.approve')?.status).toBe('NOBODY');
  });

  it('returns one row per PAIR, not per entity or per permission', async () => {
    const { service } = makeService({});
    const rows = await service.dutySegregationReadiness();
    expect(rows).toHaveLength(MAKER_CHECKER_REGISTRY.length);
    // NeedsAssessment contributes two rows sharing one permission — collapsing them would hide a pair.
    const needsAssessment = rows.filter(
      (r) => r.entityType === 'NeedsAssessment',
    );
    expect(needsAssessment).toHaveLength(2);
    expect(new Set(needsAssessment.map((r) => r.constraint)).size).toBe(2);
  });

  it('asks each DISTINCT permission once, not once per pair', async () => {
    // Two NeedsAssessment pairs share `needs-assessment.approve`. Asking twice would be two identical
    // queries, and the count of lookups is the only thing that says so.
    const { service, users } = makeService({});
    await service.dutySegregationReadiness();
    const distinct = new Set(
      MAKER_CHECKER_REGISTRY.map((p) => p.checkerPermission),
    ).size;
    expect(users.findActiveHoldersOfPermission).toHaveBeenCalledTimes(distinct);
    expect(distinct).toBeLessThan(MAKER_CHECKER_REGISTRY.length);
  });

  it('counts a person once even when two of their roles grant the code', async () => {
    const users = {
      findActiveHoldersOfPermission: vi.fn(() =>
        Promise.resolve([
          { userId: 'same-person', roleId: 'role-a' },
          { userId: 'same-person', roleId: 'role-b' },
        ]),
      ),
    };
    const service = new RoleAdminService(
      users as unknown as UserRepository,
      {} as unknown as RoleRepository,
      {} as unknown as PermissionRepository,
      {} as unknown as OrgContextService,
      {} as unknown as AuditService,
      {} as unknown as PermissionsService,
    );
    const rows = await service.dutySegregationReadiness();
    // One person holding it through two roles is ONE person, and the office is not ready.
    for (const row of rows) {
      expect(row.holderCount).toBe(1);
      expect(row.status).toBe('SINGLE_HOLDER');
    }
  });
});
