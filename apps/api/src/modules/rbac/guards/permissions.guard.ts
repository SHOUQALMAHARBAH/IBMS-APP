import {
  Injectable,
  ForbiddenException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { PermissionsService } from '../services/permissions.service';
import type { AuthenticatedUser } from '../../auth/auth.types';

/** Part 5.1 / Process #40 — the permission-check middleware. Mirrors
 * auth/guards/roles.guard.ts's shape, but resolves the caller's roles to
 * permission codes via RolePermission instead of matching a role name
 * directly, so a sensitive endpoint can be gated by *what it does*
 * (`policy.check`, `refund.approve`, ...) rather than *who's asking*. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException(
        'You do not hold a permission required to perform this action',
      );
    }

    const granted = await this.permissions.getCodesForRoles(user.roles);
    const hasPermission = required.some((code) => granted.has(code));
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not hold a permission required to perform this action',
      );
    }
    return true;
  }
}
