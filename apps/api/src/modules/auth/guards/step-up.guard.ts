import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_STEP_UP_KEY } from '../decorators/require-step-up.decorator';
import { SessionService } from '../services/session.service';
import { StepUpRequiredException } from '../auth.exceptions';
import type { AuthenticatedUser } from '../auth.types';

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_STEP_UP_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    const fresh = await this.sessions.isStepUpFresh(request.user.sessionId);
    if (!fresh) throw new StepUpRequiredException();
    return true;
  }
}
