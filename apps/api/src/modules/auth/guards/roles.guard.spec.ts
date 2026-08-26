import { describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { RoleName } from '@ibms/db';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from '../auth.types';

function makeContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function makeReflector(required: RoleName[] | undefined): Reflector {
  return { getAllAndOverride: () => required } as unknown as Reflector;
}

const user = (roles: RoleName[]): AuthenticatedUser => ({
  id: 'u1',
  email: 'u1@ibms.test',
  roles,
  sessionId: 's1',
});

describe('RolesGuard', () => {
  it('allows the request through when no @RequireRoles decorator is present', () => {
    const guard = new RolesGuard(makeReflector(undefined));
    expect(guard.canActivate(makeContext(user([])))).toBe(true);
  });

  it('allows a user holding one of the required roles', () => {
    const guard = new RolesGuard(
      makeReflector(['SYSTEM_SECURITY_ADMINISTRATOR']),
    );
    expect(
      guard.canActivate(
        makeContext(user(['SYSTEM_SECURITY_ADMINISTRATOR', 'CLAIMS_OFFICER'])),
      ),
    ).toBe(true);
  });

  it('rejects a user holding none of the required roles', () => {
    const guard = new RolesGuard(
      makeReflector(['SYSTEM_SECURITY_ADMINISTRATOR']),
    );
    expect(() =>
      guard.canActivate(makeContext(user(['CLAIMS_OFFICER']))),
    ).toThrow(ForbiddenException);
  });

  it('rejects when there is no user on the request at all', () => {
    const guard = new RolesGuard(
      makeReflector(['SYSTEM_SECURITY_ADMINISTRATOR']),
    );
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
