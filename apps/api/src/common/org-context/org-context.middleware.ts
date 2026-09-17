import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { OrgContextService } from './org-context.service';

/**
 * Multi-tenancy Phase 2 (step 7) — opens one org store per HTTP request.
 *
 * Runs as middleware, i.e. BEFORE the guards, which is the only place early
 * enough: the JWT guard itself reads tenant-scoped tables (UserSession, User,
 * SecurityConfig) while working out who the caller is, so by the time an
 * interceptor could run, scoped queries have already happened.
 *
 * The store opens with no Organization. `JwtStrategy` calls
 * `OrgContextService.adopt()` the moment the session resolves to a real user,
 * and every query after that point is filtered. Queries BEFORE that point are
 * the authentication bootstrap and run inside an explicit
 * `runUnscoped('auth-bootstrap')` block — never by accident.
 */
@Injectable()
export class OrgContextMiddleware implements NestMiddleware {
  constructor(private readonly orgContext: OrgContextService) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    this.orgContext.runForRequest(() => next());
  }
}
