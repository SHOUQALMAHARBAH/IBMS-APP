import {
  Injectable,
  ForbiddenException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RoleName } from '@ibms/db';
import { REQUIRE_ROLES_KEY } from '../decorators/require-roles.decorator';
import type { AuthenticatedUser } from '../auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleName[] | undefined>(
      REQUIRE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    const hasRole = request.user?.roles?.some((role) =>
      required.includes(role),
    );
    if (!hasRole) {
      throw new ForbiddenException(
        'You do not hold a role permitted to perform this action',
      );
    }
    return true;
  }
}
