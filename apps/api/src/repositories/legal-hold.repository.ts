import { Injectable } from '@nestjs/common';
import type { LegalHold, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateLegalHoldInput {
  scope: string;
  reason: string;
  nextReviewDueAt: Date;
  retentionScheduleItemId: string | null;
}

export interface LegalHoldFilter {
  retentionScheduleItemId?: string;
  active?: boolean;
}

/** M06 — owns `LegalHold` writes. */
@Injectable()
export class LegalHoldRepository {
  constructor(private readonly prisma: PrismaService) {}

  retentionScheduleItemExists(id: string): Promise<boolean> {
    return this.prisma.client.retentionScheduleItem
      .count({ where: { id } })
      .then((n) => n > 0);
  }

  create(input: CreateLegalHoldInput): Promise<LegalHold> {
    return this.prisma.client.legalHold.create({ data: input });
  }

  findById(id: string): Promise<LegalHold | null> {
    return this.prisma.client.legalHold.findUnique({ where: { id } });
  }

  findMany(filter: LegalHoldFilter): Promise<LegalHold[]> {
    return this.prisma.client.legalHold.findMany({
      where: {
        retentionScheduleItemId: filter.retentionScheduleItemId,
        ...(filter.active === true ? { releasedAt: null } : {}),
        ...(filter.active === false ? { releasedAt: { not: null } } : {}),
      },
      orderBy: { placedAt: 'desc' },
    });
  }

  /** Is there any currently-ACTIVE (`releasedAt IS NULL`) Legal Hold
   * against this record category? The mechanical check behind "exclude
   * records under an active Legal Hold from routine disposal." */
  hasActiveHold(retentionScheduleItemId: string): Promise<boolean> {
    return this.prisma.client.legalHold
      .count({ where: { retentionScheduleItemId, releasedAt: null } })
      .then((n) => n > 0);
  }

  /** Status-conditional — `releasedAt IS NULL` re-asserted, since a review
   * only advances an ACTIVE hold's due date. 0 rows means it was already
   * released. */
  recordReview(
    id: string,
    nextReviewDueAt: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.legalHold.updateMany({
      where: { id, releasedAt: null },
      data: { nextReviewDueAt },
    });
  }

  /** Status-conditional — `releasedAt IS NULL` re-asserted. 0 rows means
   * it was already released. */
  release(id: string, releasedAt: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.client.legalHold.updateMany({
      where: { id, releasedAt: null },
      data: { releasedAt },
    });
  }
}
