import { Injectable } from '@nestjs/common';
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
    const session = await this.sessions.findById(sessionId);
    if (!session || session.userId !== userId || session.revokedAt) {
      throw new SessionRevokedException();
    }

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
    return { id: user.id, email: user.email, roles, sessionId };
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
