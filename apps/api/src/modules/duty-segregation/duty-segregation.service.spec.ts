import { describe, expect, it, vi } from 'vitest';
import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DutySegregationService } from './duty-segregation.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * PART 4 — the engine, in the two modes and on the path that pays nothing.
 *
 * Unit tests rather than only e2e because three of these states are hard to construct against a real
 * database without leaving an office in COMBINED mode: "the office does not exist", "the actor's roles grant
 * the checker code twice", and "no role grants it at all". Each is constructed here directly.
 */

const ORG = 'org-1';

function actor(over: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    organizationId: ORG,
    email: 'one@ibms.test',
    roleIds: ['role-a'],
    roles: [],
    permissions: new Set<string>(),
    fullName: 'One Person',
    ...over,
  } as unknown as AuthenticatedUser;
}

function makeDeps(
  opts: {
    mode?: 'SEGREGATED' | 'COMBINED' | null;
    granting?: { id: string; name: string }[];
  } = {},
) {
  const findById = vi
    .fn()
    .mockResolvedValue(
      opts.mode === null
        ? null
        : { id: ORG, dutySegregationMode: opts.mode ?? 'SEGREGATED' },
    );
  const findRolesGrantingCode = vi.fn().mockResolvedValue(opts.granting ?? []);
  const create = vi
    .fn()
    .mockImplementation((data: Record<string, unknown>) =>
      Promise.resolve({ id: 'act-1', ...data }),
    );

  const service = new DutySegregationService(
    { findById } as never,
    { findRolesGrantingCode } as never,
    { create } as never,
  );
  return { service, findById, findRolesGrantingCode, create };
}

const BASE = {
  constraint: 'Refund_maker_checker_distinct',
  entityId: 'ref-1',
  context: 'Refund.approve',
} as const;

describe('DutySegregationService', () => {
  it('two different people: no act, and NO database read at all', async () => {
    const { service, findById, create } = makeDeps({ mode: 'COMBINED' });

    const result = await service.resolve({
      ...BASE,
      makerId: 'maker-1',
      checkerId: 'checker-2',
      actor: actor(),
    });

    expect(result).toBeNull();
    // The cost assertion, not a style one: this is the path every approval in the system takes, and it is
    // why the design reads the mode here rather than in fifteen triggers. If this ever starts reading the
    // office, a COMBINED-mode feature nobody uses has added a query to every approval in the product.
    expect(findById).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('no checker yet: not a violation and not an act', async () => {
    const { service, findById } = makeDeps({ mode: 'COMBINED' });
    expect(
      await service.resolve({
        ...BASE,
        makerId: 'maker-1',
        checkerId: null,
        actor: actor(),
      }),
    ).toBeNull();
    expect(findById).not.toHaveBeenCalled();
  });

  it('SEGREGATED: the same person is refused, with the remedy naming the checker permission', async () => {
    const { service, create } = makeDeps({ mode: 'SEGREGATED' });

    await expect(
      service.resolve({
        ...BASE,
        makerId: 'user-1',
        checkerId: 'user-1',
        actor: actor(),
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(create).not.toHaveBeenCalled();

    // The message is the Part 5 honesty fix, and it has to survive being routed through this service.
    await service
      .resolve({
        ...BASE,
        makerId: 'user-1',
        checkerId: 'user-1',
        actor: actor(),
      })
      .catch((err: Error) => {
        expect(err.message).toContain('refund.approve');
        expect(err.message).toContain('Roles & permissions');
      });
  });

  it('an office that cannot be read is treated as SEGREGATED', async () => {
    // Fails CLOSED. A missing office is a bug, and the safe reading of "I do not know this office's mode" is
    // the mode that refuses.
    const { service, create } = makeDeps({ mode: null });
    await expect(
      service.resolve({
        ...BASE,
        makerId: 'user-1',
        checkerId: 'user-1',
        actor: actor(),
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('COMBINED with no reason: refused, and nothing is recorded', async () => {
    const { service, create } = makeDeps({ mode: 'COMBINED' });
    await expect(
      service.resolve({
        ...BASE,
        makerId: 'user-1',
        checkerId: 'user-1',
        actor: actor(),
      }),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      service.resolve({
        ...BASE,
        makerId: 'user-1',
        checkerId: 'user-1',
        actor: actor(),
        reason: '   short   ',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(create).not.toHaveBeenCalled();
  });

  it('COMBINED with a reason: records the act, the pair, the actor and the HAT', async () => {
    const { service, create, findRolesGrantingCode } = makeDeps({
      mode: 'COMBINED',
      granting: [{ id: 'role-a', name: 'OFFICE_ADMINISTRATOR' }],
    });

    const id = await service.resolve({
      ...BASE,
      makerId: 'user-1',
      checkerId: 'user-1',
      actor: actor({ roleIds: ['role-a', 'role-b'] }),
      reason: '  The owner is the only person in this office.  ',
    });

    expect(id).toBe('act-1');
    // The hat is resolved against the CHECKER permission for this pair, from `maker-checker-pairs.config.ts`.
    // A wrong code here would record a hat nobody was wearing.
    expect(findRolesGrantingCode).toHaveBeenCalledWith(
      ['role-a', 'role-b'],
      'refund.approve',
    );
    expect(create).toHaveBeenCalledWith({
      entity: 'Refund',
      entityId: 'ref-1',
      constraintName: 'Refund_maker_checker_distinct',
      actorUserId: 'user-1',
      // Trimmed, so the stored reason and the length the floor measured are the same string.
      reason: 'The owner is the only person in this office.',
      actorRoleIds: ['role-a', 'role-b'],
      grantingRoleIds: ['role-a'],
      grantingRoleNames: ['OFFICE_ADMINISTRATOR'],
      multipleGrantingRoles: false,
    });
  });

  it('two roles granting the same code: the act says the hat is ambiguous', async () => {
    const { service, create } = makeDeps({
      mode: 'COMBINED',
      granting: [
        { id: 'role-a', name: 'OFFICE_ADMINISTRATOR' },
        { id: 'role-b', name: 'FINANCE_COLLECTIONS_OFFICER' },
      ],
    });

    await service.resolve({
      ...BASE,
      makerId: 'user-1',
      checkerId: 'user-1',
      actor: actor({ roleIds: ['role-a', 'role-b'] }),
      reason: 'One person, two roles that both allow this.',
    });

    const written = create.mock.calls[0][0] as {
      multipleGrantingRoles: boolean;
      grantingRoleNames: string[];
    };
    // "We cannot tell which hat" recorded as a fact, rather than the first row picked and presented as
    // certain. Both names are kept so a reader can see the ambiguity rather than being told about it.
    expect(written.multipleGrantingRoles).toBe(true);
    expect(written.grantingRoleNames).toEqual([
      'OFFICE_ADMINISTRATOR',
      'FINANCE_COLLECTIONS_OFFICER',
    ]);
  });

  it('no role grants the checker code: the act is still written, with an EMPTY hat', async () => {
    // Deliberate. The route guard is what refuses a caller without the permission — Rule 2, and plant 4 in
    // the plan asserts it stays a 403 in a COMBINED office. If execution reaches here with nobody granting
    // the code, something upstream is wrong, and recording "declared, hat unknown" is more useful than either
    // guessing a role or throwing an error that hides the act entirely.
    const { service, create } = makeDeps({ mode: 'COMBINED', granting: [] });

    await service.resolve({
      ...BASE,
      makerId: 'user-1',
      checkerId: 'user-1',
      actor: actor(),
      reason: 'Recorded even though the hat could not be resolved.',
    });

    const written = create.mock.calls[0][0] as {
      grantingRoleIds: string[];
      multipleGrantingRoles: boolean;
    };
    expect(written.grantingRoleIds).toEqual([]);
    expect(written.multipleGrantingRoles).toBe(false);
  });
});
