import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import type { PermissionsService } from '../services/permissions.service';
import type { AuthenticatedUser } from '../../auth/auth.types';

function makeContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function makeReflector(required: string[] | undefined): Reflector {
  return { getAllAndOverride: () => required } as unknown as Reflector;
}

function makePermissionsService(granted: string[]): PermissionsService {
  return {
    getCodesForRoles: vi.fn().mockResolvedValue(new Set(granted)),
  } as unknown as PermissionsService;
}

const user = (): AuthenticatedUser => ({
  id: 'u1',
  email: 'u1@ibms.test',
  roles: ['CLAIMS_OFFICER'],
  sessionId: 's1',
});

describe('PermissionsGuard', () => {
  it('allows the request through when no @RequirePermissions decorator is present', async () => {
    const guard = new PermissionsGuard(
      makeReflector(undefined),
      makePermissionsService([]),
    );
    await expect(guard.canActivate(makeContext(user()))).resolves.toBe(true);
  });

  it('allows a user whose roles grant one of the required permission codes', async () => {
    const guard = new PermissionsGuard(
      makeReflector(['claim.register']),
      makePermissionsService(['claim.register', 'claim.assess']),
    );
    await expect(guard.canActivate(makeContext(user()))).resolves.toBe(true);
  });

  it('rejects a user whose roles grant none of the required permission codes', async () => {
    const guard = new PermissionsGuard(
      makeReflector(['refund.approve']),
      makePermissionsService(['claim.register']),
    );
    await expect(guard.canActivate(makeContext(user()))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects when there is no user on the request at all', async () => {
    const guard = new PermissionsGuard(
      makeReflector(['refund.approve']),
      makePermissionsService(['refund.approve']),
    );
    await expect(guard.canActivate(makeContext(undefined))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
