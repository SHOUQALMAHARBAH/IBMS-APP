import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, RoleName } from '@ibms/db';
import { UserAdminService } from './user-admin.service';
import type { UserRepository } from '../../../repositories/user.repository';
import type { PasswordService } from '../../auth/services/password.service';
import type { PermissionsService } from './permissions.service';
import type { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { DepartmentRepository } from '../../../repositories/department.repository';
import { BranchRepository } from '../../../repositories/branch.repository';
import { EmployeeRepository } from '../../../repositories/employee.repository';

const actor = { id: 'admin-1' } as AuthenticatedUser;

const ADMIN_ROLE = {
  id: 'role-admin',
  name: RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
  description: null,
};
const SALES_ROLE = {
  id: 'role-sales',
  name: RoleName.SALES_RELATIONSHIP_OFFICER,
  description: null,
};

function makeDeps(over: Record<string, unknown> = {}) {
  const users = {
    findById: vi.fn().mockResolvedValue({ id: 'u-1' }),
    findRoleByName: vi.fn().mockResolvedValue(SALES_ROLE),
    findRolesByNames: vi.fn().mockResolvedValue([SALES_ROLE]),
    getRoleNames: vi
      .fn()
      .mockResolvedValue([RoleName.SALES_RELATIONSHIP_OFFICER]),
    grantRole: vi.fn().mockResolvedValue({ id: 'ura-1' }),
    revokeRole: vi.fn().mockResolvedValue(1),
    setActive: vi.fn().mockResolvedValue(1),
    // Two administrators by default, each through their own role — so the
    // lockout guard has a survivor and the ordinary paths are not blocked.
    findActiveHoldersOfPermission: vi.fn().mockResolvedValue([
      { userId: 'u-1', roleId: 'role-admin' },
      { userId: 'u-other-admin', roleId: 'role-admin' },
    ]),
    // The role being touched is NOT an administrator role unless a test says so,
    // which keeps the guard out of the way of the unrelated cases.
    roleGrantsPermission: vi.fn().mockResolvedValue(false),
    // The real one wraps `work` in a transaction holding
    // `pg_advisory_xact_lock` on (organizationId, capability), so the
    // last-administrator read and the write it gates cannot interleave with
    // another request asking the same question. Here it just runs the callback.
    withCapabilityLocked: vi.fn(
      async (_code: string, work: () => Promise<unknown>) => work(),
    ),
    listWithRoles: vi.fn().mockResolvedValue([]),
    countAll: vi.fn().mockResolvedValue(0),
    provision: vi.fn().mockResolvedValue({
      id: 'u-new',
      fullName: 'New User',
      email: 'new@ibms.internal',
      isActive: true,
      mfaEnabled: false,
      languagePreference: 'EN',
      accessValidFrom: null,
      accessValidUntil: null,
      createdAt: new Date('2026-09-09T00:00:00.000Z'),
    }),
    ...(over.users as object),
  };
  const passwords = {
    validatePolicy: vi.fn().mockReturnValue([]),
    hash: vi.fn().mockResolvedValue('hashed'),
    ...(over.passwords as object),
  };
  const permissions = {
    invalidateCache: vi.fn(),
    // Phase 2 — the segregation signal now asks what a role actually GRANTS
    // rather than what it is called, so provisioning and granting resolve each
    // role's codes. An empty set means "this role carries no checker
    // permission", which is the quiet path most of these tests want; the tests
    // that are about the signal override it.
    getCodesForRoles: vi.fn().mockResolvedValue(new Set<string>()),
    ...(over.permissions as object),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  // Part II §4.2.2 — provisioning now resolves a Department, scoped to the
  // caller's own office.
  const departments = {
    findById: vi.fn().mockResolvedValue({ id: 'dept-1', name: 'Claims' }),
    ...(over.departments as object),
  };
  // §4.2.2 — and a Branch, resolved the same tenant-scoped way.
  const branches = {
    findById: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Amman' }),
    ...(over.branches as object),
  };
  // Link-only employee lookup: absent by default, so every existing case
  // behaves as it did before the field existed.
  const employees = {
    findById: vi.fn().mockResolvedValue(null),
    ...(over.employees as object),
  };
  const service = new UserAdminService(
    departments as unknown as DepartmentRepository,
    branches as unknown as BranchRepository,
    users as unknown as UserRepository,
    employees as unknown as EmployeeRepository,
    passwords as unknown as PasswordService,
    permissions as unknown as PermissionsService,
    audit as unknown as AuditService,
  );
  return {
    service,
    users,
    passwords,
    permissions,
    audit,
    departments,
    branches,
  };
}

describe('UserAdminService.provision (backlog A.2)', () => {
  it('seats the initial role grants in the same write — never a zero-role account', async () => {
    const deps = makeDeps();
    const view = await deps.service.provision(
      {
        fullName: 'New User',
        email: 'new@ibms.internal',
        password: 'Sup3rSecret!Pass',
        departmentId: 'dept-1',
        branchId: 'branch-1',
        roles: [RoleName.SALES_RELATIONSHIP_OFFICER],
      },
      actor.id,
    );

    expect(deps.users.provision).toHaveBeenCalledWith(
      expect.objectContaining({ roleIds: ['role-sales'] }),
    );
    expect(view.roles).toEqual([RoleName.SALES_RELATIONSHIP_OFFICER]);
  });

  it('never lets the password or its hash reach the audit trail', async () => {
    const deps = makeDeps();
    await deps.service.provision(
      {
        fullName: 'New User',
        email: 'new@ibms.internal',
        password: 'Sup3rSecret!Pass',
        departmentId: 'dept-1',
        branchId: 'branch-1',
        roles: [RoleName.SALES_RELATIONSHIP_OFFICER],
      },
      actor.id,
    );
    const serialised = JSON.stringify(deps.audit.record.mock.calls);
    expect(serialised).not.toContain('Sup3rSecret');
    expect(serialised).not.toContain('hashed');
  });

  it('records the department AND the branch in the audit entry (spec §4.2.4)', async () => {
    const deps = makeDeps();
    await deps.service.provision(
      {
        fullName: 'New User',
        email: 'new@ibms.internal',
        password: 'Sup3rSecret!Pass',
        departmentId: 'dept-1',
        branchId: 'branch-1',
        roles: [RoleName.SALES_RELATIONSHIP_OFFICER],
      },
      actor.id,
    );
    const created = deps.audit.record.mock.calls.find(
      (call: [{ action: string; entityType: string }]) =>
        call[0].action === 'CREATE' && call[0].entityType === 'User',
    ) as
      | [
          {
            afterValue: {
              departmentId: string;
              departmentName: string;
              branchId: string;
              branchName: string;
            };
          },
        ]
      | undefined;
    expect(created).toBeDefined();
    // §4.2.4 asks for "which department/branch" by name as well as id — an id
    // alone is unreadable in an audit export years later.
    expect(created![0].afterValue).toMatchObject({
      departmentId: 'dept-1',
      departmentName: 'Claims',
      branchId: 'branch-1',
      branchName: 'Amman',
    });
  });

  it('refuses an unknown branch, the same way it refuses an unknown department', async () => {
    const deps = makeDeps({
      branches: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      deps.service.provision(
        {
          fullName: 'New User',
          email: 'new@ibms.internal',
          password: 'Sup3rSecret!Pass',
          departmentId: 'dept-1',
          branchId: 'another-office-branch',
          roles: [RoleName.SALES_RELATIONSHIP_OFFICER],
        },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deps.users.provision).not.toHaveBeenCalled();
  });

  it('seats the branch on the created account', async () => {
    const deps = makeDeps();
    await deps.service.provision(
      {
        fullName: 'New User',
        email: 'new@ibms.internal',
        password: 'Sup3rSecret!Pass',
        departmentId: 'dept-1',
        branchId: 'branch-1',
        roles: [RoleName.SALES_RELATIONSHIP_OFFICER],
      },
      actor.id,
    );
    expect(deps.users.provision).toHaveBeenCalledWith(
      expect.objectContaining({ departmentId: 'dept-1', branchId: 'branch-1' }),
    );
  });

  it('rejects a password that fails the Part 10.1 policy', async () => {
    const deps = makeDeps({
      passwords: { validatePolicy: vi.fn().mockReturnValue(['too short']) },
    });
    await expect(
      deps.service.provision(
        {
          fullName: 'x',
          email: 'x@ibms.internal',
          password: 'weak',
          departmentId: 'dept-1',
          branchId: 'branch-1',
          roles: [RoleName.SALES_RELATIONSHIP_OFFICER],
        },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deps.users.provision).not.toHaveBeenCalled();
  });

  it('de-duplicates repeated roles so the write cannot trip its own @@unique', async () => {
    const deps = makeDeps();
    await deps.service.provision(
      {
        fullName: 'x',
        email: 'x@ibms.internal',
        password: 'Sup3rSecret!Pass',
        departmentId: 'dept-1',
        branchId: 'branch-1',
        roles: [
          RoleName.SALES_RELATIONSHIP_OFFICER,
          RoleName.SALES_RELATIONSHIP_OFFICER,
        ],
      },
      actor.id,
    );
    expect(deps.users.provision).toHaveBeenCalledWith(
      expect.objectContaining({ roleIds: ['role-sales'] }),
    );
  });

  it('422s a role that is not in the seeded catalogue', async () => {
    const deps = makeDeps({
      users: { findRolesByNames: vi.fn().mockResolvedValue([]) },
    });
    await expect(
      deps.service.provision(
        {
          fullName: 'x',
          email: 'x@ibms.internal',
          password: 'Sup3rSecret!Pass',
          departmentId: 'dept-1',
          branchId: 'branch-1',
          roles: [RoleName.SALES_RELATIONSHIP_OFFICER],
        },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s an access window that ends before it starts', async () => {
    const deps = makeDeps();
    await expect(
      deps.service.provision(
        {
          fullName: 'x',
          email: 'x@ibms.internal',
          password: 'Sup3rSecret!Pass',
          departmentId: 'dept-1',
          branchId: 'branch-1',
          roles: [RoleName.EXTERNAL_AUDITOR],
          accessValidFrom: '2026-10-01T00:00:00.000Z',
          accessValidUntil: '2026-09-01T00:00:00.000Z',
        },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('maps a duplicate email (P2002) to a 409, not a 500', async () => {
    const deps = makeDeps({
      users: {
        provision: vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('dupe', {
            code: 'P2002',
            clientVersion: 'x',
          }),
        ),
      },
    });
    await expect(
      deps.service.provision(
        {
          fullName: 'x',
          email: 'taken@ibms.internal',
          password: 'Sup3rSecret!Pass',
          departmentId: 'dept-1',
          branchId: 'branch-1',
          roles: [RoleName.SALES_RELATIONSHIP_OFFICER],
        },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('UserAdminService role assignment', () => {
  it('grants a role and invalidates the permission cache so it takes effect at once', async () => {
    const deps = makeDeps();
    await deps.service.grantRole(
      'u-1',
      RoleName.SALES_RELATIONSHIP_OFFICER,
      actor.id,
    );
    expect(deps.users.grantRole).toHaveBeenCalledWith('u-1', 'role-sales');
    expect(deps.permissions.invalidateCache).toHaveBeenCalled();
  });

  it('404s an unknown user', async () => {
    const deps = makeDeps({
      users: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      deps.service.grantRole(
        'nope',
        RoleName.SALES_RELATIONSHIP_OFFICER,
        actor.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s a revoke of a grant that is not active', async () => {
    const deps = makeDeps({
      users: { revokeRole: vi.fn().mockResolvedValue(0) },
    });
    await expect(
      deps.service.revokeRole(
        'u-1',
        RoleName.SALES_RELATIONSHIP_OFFICER,
        actor.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to revoke the LAST active administrator — nobody could grant it back', async () => {
    const deps = makeDeps({
      users: {
        findRoleByName: vi.fn().mockResolvedValue(ADMIN_ROLE),
        roleGrantsPermission: vi.fn().mockResolvedValue(true),
        // The only holder is the very assignment being revoked, so nothing
        // survives it.
        findActiveHoldersOfPermission: vi
          .fn()
          .mockResolvedValue([{ userId: 'u-1', roleId: 'role-admin' }]),
      },
    });
    await expect(
      deps.service.revokeRole(
        'u-1',
        RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
        actor.id,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deps.users.revokeRole).not.toHaveBeenCalled();
  });

  it('allows revoking an administrator while a second one remains', async () => {
    const deps = makeDeps({
      users: {
        findRoleByName: vi.fn().mockResolvedValue(ADMIN_ROLE),
        roleGrantsPermission: vi.fn().mockResolvedValue(true),
        findActiveHoldersOfPermission: vi.fn().mockResolvedValue([
          { userId: 'u-1', roleId: 'role-admin' },
          { userId: 'u-other-admin', roleId: 'role-admin' },
        ]),
        getRoleNames: vi.fn().mockResolvedValue([]),
      },
    });
    await deps.service.revokeRole(
      'u-1',
      RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
      actor.id,
    );
    expect(deps.users.revokeRole).toHaveBeenCalledWith('u-1', 'role-admin');
  });

  it('allows revoking ONE administrator role from a user who holds the capability through another', async () => {
    // A count of holders cannot answer this: the sole holder is `u-1`, so a
    // count would say "one administrator" and refuse — even though `u-1` keeps
    // `user.manage` through a second role and nothing is lost. The guard asks
    // what survives THIS revoke, not how many holders there are.
    const deps = makeDeps({
      users: {
        findRoleByName: vi.fn().mockResolvedValue(ADMIN_ROLE),
        roleGrantsPermission: vi.fn().mockResolvedValue(true),
        findActiveHoldersOfPermission: vi.fn().mockResolvedValue([
          { userId: 'u-1', roleId: 'role-admin' },
          { userId: 'u-1', roleId: 'role-office-admin' },
        ]),
        getRoleNames: vi.fn().mockResolvedValue([]),
      },
    });
    await deps.service.revokeRole(
      'u-1',
      RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
      actor.id,
    );
    expect(deps.users.revokeRole).toHaveBeenCalledWith('u-1', 'role-admin');
  });

  it('guards a CUSTOM administrator role, which a name check never could', async () => {
    // The whole point of keying on the capability. This role is called something
    // an office chose; the old guard compared against
    // 'SYSTEM_SECURITY_ADMINISTRATOR' and so never fired for it, letting the last
    // usable administrator revoke their own access.
    const deps = makeDeps({
      users: {
        findRoleByName: vi
          .fn()
          .mockResolvedValue({ id: 'role-custom', name: 'Office Admin' }),
        roleGrantsPermission: vi.fn().mockResolvedValue(true),
        findActiveHoldersOfPermission: vi
          .fn()
          .mockResolvedValue([{ userId: 'u-1', roleId: 'role-custom' }]),
      },
    });
    await expect(
      deps.service.revokeRole('u-1', 'Office Admin', actor.id),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deps.users.revokeRole).not.toHaveBeenCalled();
  });

  it('does not take the capability lock when the role is not an administrator role', async () => {
    // Every other revoke must stay on the unguarded path — the lock serialises
    // an office's administration surface, and taking it for a Sales role would
    // make unrelated grants contend with each other.
    const deps = makeDeps({
      users: { findRoleByName: vi.fn().mockResolvedValue(SALES_ROLE) },
    });
    await deps.service.revokeRole(
      'u-1',
      RoleName.SALES_RELATIONSHIP_OFFICER,
      actor.id,
    );
    expect(deps.users.withCapabilityLocked).not.toHaveBeenCalled();
    expect(deps.users.revokeRole).toHaveBeenCalledWith('u-1', 'role-sales');
  });
});

describe('UserAdminService.setActive (de-provisioning)', () => {
  it('refuses to deactivate the calling administrator', async () => {
    const deps = makeDeps();
    await expect(
      deps.service.setActive('admin-1', false, 'admin-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deps.users.setActive).not.toHaveBeenCalled();
  });

  it('is idempotent when the account is already in the requested state', async () => {
    const deps = makeDeps({
      users: { setActive: vi.fn().mockResolvedValue(0) },
    });
    const result = await deps.service.setActive('u-1', false, actor.id);
    expect(result).toEqual({ userId: 'u-1', isActive: false });
    expect(deps.audit.record).not.toHaveBeenCalled();
  });

  it('audits a real state change', async () => {
    const deps = makeDeps();
    await deps.service.setActive('u-1', false, actor.id);
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'User', action: 'UPDATE' }),
    );
  });
});

describe('UserAdminService — the last-administrator lockout invariant', () => {
  it('takes the CAPABILITY lock around the read and the revoke, not just a bare count', () => {
    // As a plain count-then-act, two concurrent revocations of the two remaining
    // administrators both observed a survivor and both committed — leaving
    // nobody holding `user.manage` and no way to grant it back short of direct
    // database access, the precise outcome the guard exists to prevent.
    // race-safe-invariants.md § What triggers this rule names this shape.
    //
    // The lock is on the CAPABILITY, not on the Role row it used to be. A row
    // lock served while exactly one role could hold `user.manage`; now several
    // can, and two revocations against different administrator roles would lock
    // different rows and serialise against nothing.
    const deps = makeDeps({
      users: {
        findRoleByName: vi.fn().mockResolvedValue(ADMIN_ROLE),
        roleGrantsPermission: vi.fn().mockResolvedValue(true),
      },
    });
    return deps.service
      .revokeRole('u-1', RoleName.SYSTEM_SECURITY_ADMINISTRATOR, actor.id)
      .then(() => {
        expect(deps.users.withCapabilityLocked).toHaveBeenCalledWith(
          'user.manage',
          expect.any(Function),
        );
      });
  });

  it('refuses to DEACTIVATE the last active administrator', async () => {
    // The self-deactivation guard is not sufficient: two administrators
    // deactivating EACH OTHER concurrently are neither of them deactivating
    // themselves, so both calls passed and the system was left with zero
    // active administrators. Deactivating removes a usable holder just as
    // effectively as revoking — AuthService.login refuses an inactive account.
    const deps = makeDeps({
      users: {
        findRoleByName: vi.fn().mockResolvedValue(ADMIN_ROLE),
        // `u-other` is the only holder, so deactivating them leaves none.
        findActiveHoldersOfPermission: vi
          .fn()
          .mockResolvedValue([{ userId: 'u-other', roleId: 'role-admin' }]),
      },
    });
    await expect(
      deps.service.setActive('u-other', false, actor.id),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deps.users.setActive).not.toHaveBeenCalled();
  });

  it('allows deactivating an administrator while a second usable one remains', async () => {
    const deps = makeDeps({
      users: {
        findRoleByName: vi.fn().mockResolvedValue(ADMIN_ROLE),
        findActiveHoldersOfPermission: vi.fn().mockResolvedValue([
          { userId: 'u-other', roleId: 'role-admin' },
          { userId: 'u-survivor', roleId: 'role-admin' },
        ]),
      },
    });
    await deps.service.setActive('u-other', false, actor.id);
    expect(deps.users.setActive).toHaveBeenCalledWith('u-other', false);
  });

  it('does not refuse when deactivating a NON-administrator', async () => {
    // The holder list does not contain this user, so the guard has nothing to
    // say. Unlike revoke, deactivation takes the lock either way: it cannot know
    // whether the subject is an administrator without reading the holders, and
    // reading them outside the lock is the race.
    const deps = makeDeps({
      users: {
        findRoleByName: vi.fn().mockResolvedValue(ADMIN_ROLE),
        findActiveHoldersOfPermission: vi
          .fn()
          .mockResolvedValue([{ userId: 'u-1', roleId: 'role-admin' }]),
      },
    });
    await deps.service.setActive('u-sales', false, actor.id);
    expect(deps.users.setActive).toHaveBeenCalledWith('u-sales', false);
  });

  it('never blocks REACTIVATION', async () => {
    const deps = makeDeps({
      users: { findRoleByName: vi.fn().mockResolvedValue(ADMIN_ROLE) },
    });
    await deps.service.setActive('u-other', true, actor.id);
    expect(deps.users.setActive).toHaveBeenCalledWith('u-other', true);
    expect(deps.users.withCapabilityLocked).not.toHaveBeenCalled();
  });
});

describe('UserAdminService — segregation-of-duties visibility', () => {
  // assertDifferentActors enforces maker != checker on ONE identity. It cannot
  // see that one human holds two. A `user.manage` holder can provision a
  // second account carrying the other half of any pair and work both sides
  // single-handed. maker-checker-segregation.md is explicit that admin
  // consoles are NOT exempt from that rule, so this is not a lex gap — it is a
  // gap in what the system can see. These pin the visibility half.
  //
  // Phase 2 re-keyed the signal from role NAMES to the checker PERMISSIONS a
  // role grants, so these tests now say what the role grants rather than only
  // what it is called. That is the whole change: a role an office defines,
  // holding `policy.check`, used to be handed out with no signal at all.

  it('records a signal when a CHECKER role is granted', async () => {
    const deps = makeDeps({
      users: {
        findRoleByName: vi.fn().mockResolvedValue({
          id: 'r-comp',
          name: RoleName.COMPLIANCE_OFFICER,
        }),
      },
      permissions: {
        getCodesForRoles: vi.fn().mockResolvedValue(new Set(['kyc.approve'])),
      },
    });
    await deps.service.grantRole('u-1', RoleName.COMPLIANCE_OFFICER, actor.id);

    const serialised = JSON.stringify(deps.audit.record.mock.calls);
    expect(serialised).toContain('SegregationOfDutiesSignal');
    expect(serialised).toContain('COMPLIANCE_OFFICER');
  });

  it('marks a SELF-grant distinctly — no second account is even needed', async () => {
    const deps = makeDeps({
      users: {
        findRoleByName: vi.fn().mockResolvedValue({
          id: 'r-fin',
          name: RoleName.FINANCE_COLLECTIONS_OFFICER,
        }),
      },
      permissions: {
        getCodesForRoles: vi
          .fn()
          .mockResolvedValue(new Set(['refund.approve'])),
      },
    });
    // The administrator grants the checker role to their own account.
    await deps.service.grantRole(
      actor.id,
      RoleName.FINANCE_COLLECTIONS_OFFICER,
      actor.id,
    );

    const call = deps.audit.record.mock.calls.find(
      ([input]: [{ entityType: string }]) =>
        input.entityType === 'SegregationOfDutiesSignal',
    ) as [{ afterValue: { selfGrant: boolean } }] | undefined;
    expect(call).toBeDefined();
    expect(call![0].afterValue.selfGrant).toBe(true);
  });

  it('stays silent for a role that is NOT a checker', async () => {
    const deps = makeDeps({
      users: {
        findRoleByName: vi.fn().mockResolvedValue({
          id: 'r-sales',
          name: RoleName.SALES_RELATIONSHIP_OFFICER,
        }),
      },
    });
    await deps.service.grantRole(
      'u-1',
      RoleName.SALES_RELATIONSHIP_OFFICER,
      actor.id,
    );
    expect(JSON.stringify(deps.audit.record.mock.calls)).not.toContain(
      'SegregationOfDutiesSignal',
    );
  });

  it('signals on PROVISION too, not only on a later grant', async () => {
    // Provisioning a fresh account that already carries a checker role is the
    // exact "second identity" shape, so it must be as visible as a grant.
    const deps = makeDeps({
      permissions: {
        getCodesForRoles: vi.fn().mockResolvedValue(new Set(['kyc.approve'])),
      },
    });
    await deps.service.provision(
      {
        fullName: 'Second Identity',
        email: 'second@ibms.internal',
        password: 'Str0ng!Passphrase-2026',
        departmentId: 'dept-1',
        branchId: 'branch-1',
        roles: [RoleName.DATA_PROTECTION_OFFICER],
      },
      actor.id,
    );
    expect(JSON.stringify(deps.audit.record.mock.calls)).toContain(
      'SegregationOfDutiesSignal',
    );
  });

  it('never fails the grant when the signal cannot be written', async () => {
    const deps = makeDeps({
      users: {
        findRoleByName: vi.fn().mockResolvedValue({
          id: 'r-comp',
          name: RoleName.COMPLIANCE_OFFICER,
        }),
      },
    });
    deps.audit.record.mockRejectedValue(new Error('audit down'));
    await expect(
      deps.service.grantRole('u-1', RoleName.COMPLIANCE_OFFICER, actor.id),
    ).resolves.toBeDefined();
  });
});
