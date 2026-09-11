import { Injectable } from '@nestjs/common';
import { OrgContextService } from '../../../common/org-context/org-context.service';
import type { RoleName } from '@ibms/db';
import { UserSessionRepository } from '../../../repositories/user-session.repository';
import { UserRepository } from '../../../repositories/user.repository';
import { AuditService } from '../../audit/audit.service';
import { SecurityConfigService } from './security-config.service';
import {
  AccessWindowExpiredException,
  SessionIdleTimeoutException,
  SessionRevokedException,
} from '../auth.exceptions';
import { requiresHardwareToken, type AuthenticatedUser } from '../auth.types';

@Injectable()
export class SessionService {
  constructor(
    private readonly sessions: UserSessionRepository,
    private readonly users: UserRepository,
    private readonly securityConfig: SecurityConfigService,
    private readonly audit: AuditService,
    private readonly orgContext: OrgContextService,
  ) {}

  async create(params: {
    userId: string;
    refreshTokenId?: string;
    userAgent?: string;
    ipAddress?: string;
  }) {
    const config = await this.securityConfig.get();
    const expiresAt = new Date(
      Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
    return this.sessions.create({ ...params, expiresAt });
  }

  /**
   * Runs on every authenticated request (called from JwtStrategy.validate).
   * Enforces idle-timeout AND the External Auditor time-boxed access window
   * (Part 5.1) against a *live* session — not just at login — then bumps
   * `lastActivityAt`. Throws a CodedUnauthorizedException on any failure.
   */
  async validateAndTouch(
    userId: string,
    sessionId: string,
  ): Promise<AuthenticatedUser> {
    // Multi-tenancy Phase 2 (step 7) — this method is where an anonymous
    // request becomes an Organization's request, so it owns its own scoping
    // rather than being wrapped wholesale by the caller.
    //
    // EXACTLY ONE read is unscoped: resolving the session by its id. That is
    // unavoidable — it is the lookup that establishes which Organization the
    // caller belongs to. Everything after it, including the audit writes
    // below, runs scoped.
    //
    // An earlier version wrapped this whole method in the bypass instead. That
    // was wrong in a way the e2e suite caught: the ACCESS_WINDOW_EXPIRED audit
    // row was then written with no Organization, hit the column's NOT NULL and
    // surfaced as a 500 where the caller expected a 401. A bypass must cover
    // the reads that identify the caller, never the writes that follow.
    const session = await this.orgContext.runUnscoped('auth-bootstrap', () =>
      this.sessions.findById(sessionId),
    );
    if (!session || session.userId !== userId || session.revokedAt) {
      throw new SessionRevokedException();
    }

    // The session row carries its own Organization, so the caller's org is
    // known from here on — and the user lookup below is now scoped by it,
    // which means a token can never resolve a user in another Organization.
    this.orgContext.adopt(session.organizationId);

    const user = await this.users.findById(userId);
    if (!user || !user.isActive) {
      await this.sessions.revoke(sessionId, 'admin_revoked');
      throw new SessionRevokedException();
    }

    if (user.accessValidUntil && user.accessValidUntil.getTime() < Date.now()) {
      await this.sessions.revoke(sessionId, 'access_window_expired');
      await this.audit.record({
        userId,
        action: 'ACCESS_WINDOW_EXPIRED',
        entityType: 'User',
        entityId: userId,
      });
      throw new AccessWindowExpiredException();
    }

    const config = await this.securityConfig.get();
    const idleMs = config.idleTimeoutMinutes * 60 * 1000;
    if (Date.now() - session.lastActivityAt.getTime() > idleMs) {
      await this.sessions.revoke(sessionId, 'idle_timeout');
      throw new SessionIdleTimeoutException();
    }

    await this.sessions.touchActivity(sessionId);
    const roles = await this.users.getRoleNames(userId);
    return {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      roles,
      sessionId,
    };
  }

  async heartbeat(sessionId: string, userId: string) {
    // Re-runs the same checks as validateAndTouch — the heartbeat endpoint
    // exists so the frontend can keep a session alive during page-view-only
    // activity (mouse/keyboard) between real API calls.
    return this.validateAndTouch(userId, sessionId);
  }

  async stepUp(sessionId: string): Promise<void> {
    await this.sessions.markSteppedUp(sessionId);
  }

  async isStepUpFresh(sessionId: string): Promise<boolean> {
    const session = await this.sessions.findById(sessionId);
    if (!session?.lastStepUpAt) return false;
    const config = await this.securityConfig.get();
    const maxAgeMs = config.stepUpMaxAgeMinutes * 60 * 1000;
    return Date.now() - session.lastStepUpAt.getTime() <= maxAgeMs;
  }

  findSessionByRefreshTokenId(refreshTokenId: string) {
    return this.sessions.findByRefreshTokenId(refreshTokenId);
  }

  linkRefreshToken(sessionId: string, refreshTokenId: string) {
    return this.sessions.linkRefreshToken(sessionId, refreshTokenId);
  }

  logout(sessionId: string): Promise<void> {
    return this.sessions.revoke(sessionId, 'logout');
  }

  revokeAllForUser(
    userId: string,
    reason: 'password_reset' | 'admin_revoked' = 'password_reset',
  ) {
    return this.sessions.revokeAllForUser(userId, reason);
  }

  listActive(userId: string) {
    return this.sessions.findActiveByUser(userId);
  }

  requiresHardwareToken(roles: RoleName[]): boolean {
    return requiresHardwareToken(roles);
  }
}
