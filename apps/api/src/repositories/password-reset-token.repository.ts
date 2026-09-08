import { Injectable } from '@nestjs/common';
import type { PasswordResetToken } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PasswordResetTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByHash(tokenHash: string): Promise<PasswordResetToken | null> {
    return this.prisma.client.passwordResetToken.findUnique({
      where: { tokenHash },
    });
  }

  create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedIp?: string;
  }): Promise<PasswordResetToken> {
    return this.prisma.client.passwordResetToken.create({ data });
  }

  /** Status-conditional claim: only marks the token used if it hasn't been
   * used yet — the real race backstop for `AuthService.resetPassword`'s
   * "was this token already used?" check (race-safe-invariants.md).
   * `false` when 0 rows matched (a concurrent reset already claimed it). */
  async markUsed(id: string): Promise<boolean> {
    const { count } = await this.prisma.client.passwordResetToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count > 0;
  }

  async invalidateAllForUser(userId: string): Promise<void> {
    await this.prisma.client.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }
}
