import {
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  // Preserves the specific CodedUnauthorizedException thrown from
  // JwtStrategy#validate (idle timeout / access-window expiry / revoked)
  // instead of collapsing every failure into a generic 401.
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
  ): TUser {
    if (err instanceof Error) throw err;
    if (err) throw new UnauthorizedException('Authentication failed');
    if (!user) {
      const message =
        info instanceof Error ? info.message : 'Authentication required';
      throw new UnauthorizedException(message);
    }
    return user;
  }
}
