import { Injectable } from '@nestjs/common';
import type { UserSession } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export type SessionRevokedReason =
  | 'idle_timeout'
  | 'logout'
  | 'access_window_expired'
  | 'admin_revoked'
  | 'refresh_reuse_detected'
  | 'password_reset';

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
    userAgent?: string;
    ipAddress?: string;
  }): Promise<UserSession> {
    return this.prisma.client.userSession.create({ data });
  }

  touchActivity(id: string): Promise<UserSession> {
    return this.prisma.client.userSession.update({
      where: { id },
      data: { lastActivityAt: new Date() },
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

  async revokeAllForUser(
    userId: string,
    reason: SessionRevokedReason,
  ): Promise<void> {
    await this.prisma.client.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  findActiveByUser(userId: string): Promise<UserSession[]> {
    return this.prisma.client.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActivityAt: 'desc' },
    });
  }
}
