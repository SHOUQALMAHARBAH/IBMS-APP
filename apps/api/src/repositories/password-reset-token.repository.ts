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

  async markUsed(id: string): Promise<void> {
    await this.prisma.client.passwordResetToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async invalidateAllForUser(userId: string): Promise<void> {
    await this.prisma.client.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }
}
