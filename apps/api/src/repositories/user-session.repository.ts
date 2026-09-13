import { Injectable } from '@nestjs/common';
import type { UserSession } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export type SessionRevokedReason =
  | 'idle_timeout'
  | 'logout'
  | 'access_window_expired'
  | 'admin_revoked'
  | 'refresh_reuse_detected'
  | 'password_reset'
  /// Part II §4.7.4 — a self-service password change revokes every OTHER
  /// session. Distinct from `password_reset` (the forgot-password flow) so the
  /// audit trail says which of the two happened.
  | 'password_changed';

@Injectable()
export class UserSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<UserSession | null> {
    return this.prisma.client.userSession.findUnique({ where: { id } });
  }

  findByRefreshTokenId(refreshTokenId: string): Promise<UserSession | null> {
    return this.prisma.client.userSession.findUnique({
      where: { refreshTokenId },
    });
  }

  create(data: {
    userId: string;
    refreshTokenId?: string;
    expiresAt: Date;
    /** Part II §4.1.5 — moves forward on activity. */
    idleExpiresAt: Date;
    /** Part II §4.1.5 — never moves, whatever the user does. */
    absoluteExpiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<UserSession> {
    return this.prisma.client.userSession.create({ data });
  }

  /**
   * Records activity and pushes the idle ceiling out.
   *
   * `absoluteExpiresAt` is deliberately NOT touched: it is the cap that a busy
   * user cannot extend by being busy, which is the only thing separating it
   * from `idleExpiresAt`.
   */
  touchActivity(id: string, idleExpiresAt: Date): Promise<UserSession> {
    return this.prisma.client.userSession.update({
      where: { id },
      data: { lastActivityAt: new Date(), idleExpiresAt },
    });
  }

  markSteppedUp(id: string): Promise<UserSession> {
    return this.prisma.client.userSession.update({
      where: { id },
      data: { lastStepUpAt: new Date() },
    });
  }

  linkRefreshToken(id: string, refreshTokenId: string): Promise<UserSession> {
    return this.prisma.client.userSession.update({
      where: { id },
      data: { refreshTokenId },
    });
  }

  async revoke(id: string, reason: SessionRevokedReason): Promise<void> {
    await this.prisma.client.userSession.update({
      where: { id },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Returns the number of rows actually revoked (Part V multi-tenancy item
   * 6). A legitimate zero exists — a user may have no open sessions — so the count is
   * reported rather than asserted; what it buys is that a caller or test can
   * check the post-condition instead of trusting a `void` return, which is
   * how an RLS-zero-filtered revoke passed for success in Phase 2 step 8. */
  async revokeAllForUser(
    userId: string,
    reason: SessionRevokedReason,
  ): Promise<number> {
    const { count } = await this.prisma.client.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  /**
   * Part II §4.7.4 — revokes every OTHER live session for a user.
   *
   * The session that made the change is spared deliberately: logging someone
   * out of the screen they just used would make a routine password change feel
   * like a failure. Returns the count, so the caller can report and assert it.
   */
  async revokeAllForUserExcept(
    userId: string,
    keepSessionId: string,
    reason: SessionRevokedReason,
  ): Promise<number> {
    const { count } = await this.prisma.client.userSession.updateMany({
      where: { userId, id: { not: keepSessionId }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  findActiveByUser(userId: string): Promise<UserSession[]> {
    return this.prisma.client.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActivityAt: 'desc' },
    });
  }
}
