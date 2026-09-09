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
    countActiveHoldersOfRole: vi.fn().mockResolvedValue(2),
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
  const permissions = { invalidateCache: vi.fn() };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new UserAdminService(
    users as unknown as UserRepository,
    passwords as unknown as PasswordService,
    permissions as unknown as PermissionsService,
    audit as unknown as AuditService,
  );
  return { service, users, passwords, permissions, audit };
}

describe('UserAdminService.provision (backlog A.2)', () => {
  it('seats the initial role grants in the same write — never a zero-role account', async () => {
    const deps = makeDeps();
    const view = await deps.service.provision(
      {
        fullName: 'New User',
        email: 'new@ibms.internal',
        password: 'Sup3rSecret!Pass',
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
        roles: [RoleName.SALES_RELATIONSHIP_OFFICER],
      },
      actor.id,
    );
    const serialised = JSON.stringify(deps.audit.record.mock.calls);
    expect(serialised).not.toContain('Sup3rSecret');
    expect(serialised).not.toContain('hashed');
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
        countActiveHoldersOfRole: vi.fn().mockResolvedValue(1),
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
        countActiveHoldersOfRole: vi.fn().mockResolvedValue(2),
      },
    });
    await deps.service.revokeRole(
      'u-1',
      RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
      actor.id,
    );
    expect(deps.users.revokeRole).toHaveBeenCalledWith('u-1', 'role-admin');
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
