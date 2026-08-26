import { Injectable } from '@nestjs/common';
import type { RoleName, User } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({ where: { id } });
  }

  async getRoleNames(userId: string): Promise<RoleName[]> {
    const assignments = await this.prisma.client.userRoleAssignment.findMany({
      where: { userId, revokedAt: null },
      include: { role: true },
    });
    return assignments.map((a) => a.role.name);
  }

  /** Minimal display info for a set of users — e.g. rendering a
   * recertification queue without exposing full User records. */
  findSummariesByIds(
    ids: string[],
  ): Promise<{ id: string; fullName: string; email: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.client.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true },
    });
  }

  create(data: {
    fullName: string;
    email: string;
    passwordHash: string;
    languagePreference?: 'AR' | 'EN';
  }): Promise<User> {
    return this.prisma.client.user.create({
      data: { ...data, passwordUpdatedAt: new Date() },
    });
  }

  recordSuccessfulLogin(userId: string): Promise<User> {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
  }

  async recordFailedLogin(
    userId: string,
    lockUntil: Date | null,
  ): Promise<void> {
    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: { increment: 1 },
        ...(lockUntil ? { lockedUntil: lockUntil } : {}),
      },
    });
  }

  setMfaEnabled(userId: string, enabled: boolean): Promise<User> {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: { mfaEnabled: enabled },
    });
  }

  updatePassword(userId: string, passwordHash: string): Promise<User> {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: { passwordHash, passwordUpdatedAt: new Date() },
    });
  }
}
