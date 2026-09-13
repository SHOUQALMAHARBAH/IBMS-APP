import { Injectable } from '@nestjs/common';
import type { PasswordHistoryEntry } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Part II §4.3.1/§4.7 — the user's previous password hashes, so a "new"
 * password that is really an old one can be refused.
 *
 * The model has existed since Phase 1 and had no consumer until now.
 *
 * Only hashes are kept, and they are kept for exactly one purpose: comparing a
 * proposed password against them. Nothing reads this table for any other
 * reason, and nothing ever needs the plaintext.
 */
@Injectable()
export class PasswordHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The most recent `depth` hashes for a user, newest first.
   *
   * Bounded rather than "all of them": §4.7.3 asks that reuse of roughly the
   * last five be refused, and comparing a candidate against an unbounded
   * history would make a password change slower for every long-serving employee
   * — each comparison is a deliberate bcrypt round.
   */
  recentForUser(
    userId: string,
    depth: number,
  ): Promise<PasswordHistoryEntry[]> {
    return this.prisma.client.passwordHistoryEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: depth,
    });
  }

  append(userId: string, passwordHash: string): Promise<PasswordHistoryEntry> {
    return this.prisma.client.passwordHistoryEntry.create({
      data: { userId, passwordHash },
    });
  }
}
