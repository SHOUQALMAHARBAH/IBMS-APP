import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_MFA_REQUIRED_KEY } from '../decorators/skip-mfa-required.decorator';
import { UserRepository } from '../../../repositories/user.repository';
import {
  MfaRequiredException,
  OnboardingIncompleteException,
} from '../auth.exceptions';
import type { AuthenticatedUser } from '../auth.types';

/**
 * Part 10.1 — "MFA enrollment/verification per user, mandatory for
 * everyone." Runs after JwtAuthGuard. A logged-in-but-not-yet-enrolled user
 * can still reach MFA enrollment / their own profile / logout — everything
 * else is blocked until User.mfaEnabled is true.
 */
@Injectable()
export class MfaRequiredGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isExempt = this.reflector.getAllAndOverride<boolean>(
      SKIP_MFA_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic || isExempt) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    if (!request.user) return true; // JwtAuthGuard will have already rejected this request

    const user = await this.users.findById(request.user.id);

    // Part II §4.3 — the onboarding wizard is uninterruptible: until BOTH steps
    // are done, no other API call succeeds. The password step comes first, so
    // it is checked first; a user who still owes it should never be told about
    // an MFA step they have not reached.
    //
    // In the normal flow this is belt-and-braces — a user owing the password
    // change is never issued a session at all (§4.3.1). It matters for the case
    // that is not the normal flow: an administrator setting the flag on an
    // account that is already signed in somewhere.
    if (user?.mustChangePassword) {
      throw new OnboardingIncompleteException();
    }
    if (!user?.mfaEnabled) {
      throw new MfaRequiredException();
    }
    return true;
  }
}
