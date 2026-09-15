import { Injectable } from '@nestjs/common';
import type { RefreshToken } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.client.refreshToken.findUnique({ where: { tokenHash } });
  }

  create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<RefreshToken> {
    return this.prisma.client.refreshToken.create({ data });
  }

  async revoke(id: string, replacedByTokenId?: string): Promise<void> {
    await this.prisma.client.refreshToken.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        ...(replacedByTokenId ? { replacedByTokenId } : {}),
      },
    });
  }

  /** Returns the number of rows actually revoked (Part V multi-tenancy item
   * 6). A legitimate zero exists — a user may hold nothing live — so the count is
   * reported rather than asserted; what it buys is that a caller or test can
   * check the post-condition instead of trusting a `void` return, which is
   * how an RLS-zero-filtered revoke passed for success in Phase 2 step 8. */
  async revokeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }
}
