import { describe, expect, it, vi } from 'vitest';
import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RoleName } from '@ibms/db';
import { UserAdminService } from './user-admin.service';
import type { UserRepository } from '../../../repositories/user.repository';
import type { PasswordService } from '../../auth/services/password.service';
import type { PermissionsService } from './permissions.service';
import type { AuditService } from '../../audit/audit.service';
import type { DepartmentRepository } from '../../../repositories/department.repository';
import type { BranchRepository } from '../../../repositories/branch.repository';
import type { EmployeeRepository } from '../../../repositories/employee.repository';
import type { EncryptionService } from '../../security/encryption.service';
import type { PrismaService } from '../../../prisma/prisma.service';

/**
 * ONE PERSON, ONE ACT — `POST /admin/users` with an `employee` block.
 *
 * Registering someone who needs a login used to be two requests in a fixed order: create the HR
 * record, then create the account naming it by id. That produced the defect the owner met head-on —
 * the account form listed employees in a picker, and the person being registered was by definition
 * never in it — and a worse latent one: the second request can fail, leaving a person who half
 * exists with nothing on screen to say which half.
 *
 * These tests are about the properties that make the pair one act rather than two calls stapled
 * together. The atomicity itself is proven end to end in `paired-person-account.e2e-spec.ts`, against
 * a real transaction and a real unique constraint; what is checked here is the composition and the
 * refusals, which is what a mocked test can actually prove.
 */
const ROLE = {
  id: 'role-sales',
  name: RoleName.SALES_RELATIONSHIP_OFFICER,
  description: null,
};

const PERSON = {
  givenName: 'سلمى',
  fatherName: 'خالد',
  familyName: 'المحاربة',
  nationalId: '9881234567',
  hireDate: '2026-02-01',
  position: 'مسؤولة إنتاج',
};

const ACCOUNT = {
  email: 'salma@ibms.internal',
  password: 'Sup3rSecret!Pass',
  departmentId: 'dept-1',
  branchId: 'branch-1',
  roleIds: [ROLE.id],
};

/** A transaction client distinguishable from the ordinary one, so "inside the transaction" is a
 *  thing a test can actually observe rather than infer. */
const TX = { marker: 'the-transaction' };

function makeService(
  over: {
    granted?: string[];
    users?: Record<string, unknown>;
    employees?: Record<string, unknown>;
    transaction?: unknown;
  } = {},
) {
  const users = {
    findRolesByIds: vi.fn().mockResolvedValue([ROLE]),
    findByEmployeeId: vi.fn().mockResolvedValue(null),
    getRoleRefs: vi.fn().mockResolvedValue([ROLE]),
    findActiveHoldersOfPermission: vi.fn().mockResolvedValue([]),
    provision: vi.fn().mockResolvedValue({
      id: 'user-9',
      email: ACCOUNT.email,
      fullName: 'سلمى خالد المحاربة',
      isActive: true,
      mfaEnabled: false,
      languagePreference: 'AR',
      accessValidFrom: null,
      accessValidUntil: null,
      createdAt: new Date('2026-02-01T08:00:00.000Z'),
      employeeId: 'emp-9',
    }),
    ...(over.users ?? {}),
  };
  const employees = {
    findById: vi.fn().mockResolvedValue(null),
    create: vi
      .fn()
      .mockImplementation((input: { id: string }) => Promise.resolve(input)),
    ...(over.employees ?? {}),
  };
  const departments = {
    findById: vi.fn().mockResolvedValue({ id: 'dept-1', name: 'Claims' }),
  };
  const branches = {
    findById: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'Irbid' }),
  };
  const passwords = {
    validatePolicy: vi.fn().mockReturnValue([]),
    hash: vi.fn().mockResolvedValue('hashed'),
  };
  const permissions = {
    getCodesForRoles: vi
      .fn()
      .mockResolvedValue(new Set<string>(over.granted ?? ['employee.create'])),
    invalidateCache: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const encryption = {
    encrypt: vi.fn().mockResolvedValue('enc:national-id'),
  };
  const prisma = {
    client: {
      $transaction:
        over.transaction ??
        vi
          .fn()
          .mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
            fn(TX),
          ),
    },
  };

  const service = new UserAdminService(
    departments as unknown as DepartmentRepository,
    branches as unknown as BranchRepository,
    users as unknown as UserRepository,
    employees as unknown as EmployeeRepository,
    passwords as unknown as PasswordService,
    permissions as unknown as PermissionsService,
    audit as unknown as AuditService,
    encryption as unknown as EncryptionService,
    prisma as unknown as PrismaService,
  );
  return { service, users, employees, audit, encryption, prisma, permissions };
}

describe('a person and their account are created in one act', () => {
  it('writes BOTH rows inside the same transaction', async () => {
    const deps = makeService();
    await deps.service.provision({ ...ACCOUNT, employee: PERSON }, 'admin-1', [
      'role-admin',
    ]);

    // Not "a transaction was opened" — that a transaction was opened and BOTH writes went into it.
    // Either write landing on the ordinary client would leave exactly the half-created person this
    // whole change exists to make impossible, and the call would still succeed.
    expect(deps.employees.create).toHaveBeenCalledWith(
      expect.objectContaining({ givenName: 'سلمى' }),
      TX,
    );
    expect(deps.users.provision).toHaveBeenCalledWith(
      expect.objectContaining({ email: ACCOUNT.email }),
      TX,
    );
  });

  it('opens NO transaction when there is no person — the account-only path is untouched', async () => {
    const deps = makeService();
    await deps.service.provision(
      { ...ACCOUNT, fullName: 'External Auditor' },
      'admin-1',
      ['role-admin'],
    );

    expect(deps.prisma.client.$transaction).not.toHaveBeenCalled();
    // One argument, not two: the repository takes the transaction client optionally and this path
    // must not pass one.
    expect(deps.users.provision).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'External Auditor' }),
    );
  });

  it("composes the account's display name from the person's parts", async () => {
    const deps = makeService();
    await deps.service.provision({ ...ACCOUNT, employee: PERSON }, 'admin-1', [
      'role-admin',
    ]);

    // `User.fullName` is a stored NOT NULL column and stays one — an audit row holds a userId and
    // nothing else, so the name has to be readable from the account years later. Stored, and never
    // typed twice.
    const person = deps.employees.create.mock.calls[0][0] as {
      fullName: string;
    };
    const account = deps.users.provision.mock.calls[0][0] as {
      fullName: string;
    };
    expect(person.fullName).toBe('سلمى خالد المحاربة');
    expect(account.fullName).toBe(person.fullName);
  });

  it('leaves fullNameEn NULL when no English name was given, and composes it when it was', async () => {
    const without = makeService();
    await without.service.provision(
      { ...ACCOUNT, employee: PERSON },
      'admin-1',
      ['r'],
    );
    expect(
      (without.employees.create.mock.calls[0][0] as { fullNameEn?: string })
        .fullNameEn,
    ).toBeUndefined();

    const with_ = makeService();
    await with_.service.provision(
      {
        ...ACCOUNT,
        employee: {
          ...PERSON,
          givenNameEn: 'Salma',
          familyNameEn: 'Almaharbah',
        },
      },
      'admin-1',
      ['r'],
    );
    // Composed from what was given — no transliteration is invented for the father's name that was
    // left out, and the gap is visible rather than filled in.
    expect(
      (with_.employees.create.mock.calls[0][0] as { fullNameEn?: string })
        .fullNameEn,
    ).toBe('Salma Almaharbah');
  });

  it("files the person under the ACCOUNT's department and branch", async () => {
    const deps = makeService();
    await deps.service.provision({ ...ACCOUNT, employee: PERSON }, 'admin-1', [
      'role-admin',
    ]);

    // One pair of values used twice. The department-disagreement ConflictException both link paths
    // raise is unreachable here BY CONSTRUCTION, which is better than refused: the screen has one
    // department field, so there is nothing for the two rows to disagree about.
    const person = deps.employees.create.mock.calls[0][0] as {
      departmentId?: string;
      branchId?: string;
    };
    expect(person.departmentId).toBe('dept-1');
    expect(person.branchId).toBe('branch-1');
  });

  it('refuses the person half to a caller who holds user.manage but not employee.create', async () => {
    // The measured state this protects: a Branch/Department Manager holds `employee.create` and NOT
    // `user.manage`; an office administrator holds both. The inverse — a role that can issue logins
    // but not create people — is equally constructible on the Role screen, and it must not get a
    // person record as a side effect of provisioning an account.
    const deps = makeService({ granted: ['user.manage'] });
    await expect(
      deps.service.provision({ ...ACCOUNT, employee: PERSON }, 'admin-1', [
        'role-x',
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // And nothing was written. A refusal that still created the person would be worse than no check.
    expect(deps.employees.create).not.toHaveBeenCalled();
    expect(deps.users.provision).not.toHaveBeenCalled();
  });

  it('refuses a person block sent together with employeeId, rather than picking one', async () => {
    const deps = makeService();
    await expect(
      deps.service.provision(
        { ...ACCOUNT, employee: PERSON, employeeId: 'emp-existing' },
        'admin-1',
        ['role-admin'],
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('refuses a fullName sent alongside a person, rather than choosing a spelling', async () => {
    const deps = makeService();
    await expect(
      deps.service.provision(
        { ...ACCOUNT, employee: PERSON, fullName: 'Salma A.' },
        'admin-1',
        ['role-admin'],
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('fails LOUDLY if a caller sends a person without the actor roles to check', async () => {
    // A silent bypass here would be an authorization hole: `employee.create` simply would not be
    // checked. The optional parameter exists because 13 existing call sites do not send a person, and
    // this is what stops it from being a hole for the fourteenth.
    const deps = makeService();
    await expect(
      deps.service.provision({ ...ACCOUNT, employee: PERSON }, 'admin-1'),
    ).rejects.toThrow(/actor role ids/);
    expect(deps.employees.create).not.toHaveBeenCalled();
  });

  it('audits the person as its own CREATE, and never the national ID', async () => {
    const deps = makeService();
    await deps.service.provision({ ...ACCOUNT, employee: PERSON }, 'admin-1', [
      'role-admin',
    ]);

    const entries = deps.audit.record.mock.calls.map(
      (c) =>
        c[0] as { entityType: string; afterValue?: Record<string, unknown> },
    );
    const employeeRow = entries.find((e) => e.entityType === 'Employee');
    const userRow = entries.find((e) => e.entityType === 'User');
    // Two entities were created under two different permissions. One row saying "a User was created"
    // would leave the HR record's creation recorded nowhere, and `POST /employees` writes this same
    // row for the same act.
    expect(employeeRow, 'the person needs its own audit row').toBeDefined();
    expect(userRow).toBeDefined();
    // Recoverable from either side.
    expect(employeeRow?.afterValue?.linkedUserId).toBe('user-9');

    const serialised = JSON.stringify(deps.audit.record.mock.calls);
    // Part 10.2 — Highly Confidential. Not the value, and not the ciphertext either: the ciphertext
    // IS the datum, and an audit trail is exported.
    expect(serialised).not.toContain(PERSON.nationalId);
    expect(serialised).not.toContain('enc:national-id');
    expect(serialised).not.toContain('Sup3rSecret');
  });

  it('encrypts the national ID BEFORE the transaction opens', async () => {
    // A transaction held open across a KMS round trip is a lock held across the network. The order is
    // observable: the encrypt call must have happened before $transaction was invoked.
    const order: string[] = [];
    const deps = makeService({
      transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
          order.push('transaction');
          return fn(TX);
        }),
    });
    deps.encryption.encrypt.mockImplementation(() => {
      order.push('encrypt');
      return Promise.resolve('enc:national-id');
    });

    await deps.service.provision({ ...ACCOUNT, employee: PERSON }, 'admin-1', [
      'role-admin',
    ]);
    expect(order).toEqual(['encrypt', 'transaction']);
  });
});
