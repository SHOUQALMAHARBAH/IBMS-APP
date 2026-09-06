import { Injectable } from '@nestjs/common';
import type { Prisma, PrivacyNotice } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreatePrivacyNoticeInput {
  touchpoint: string;
  versionNumber: number;
  textAr: string;
  textEn: string;
}

/** M-series — owns `PrivacyNotice`. Append-only except for
 * `recordLegalReview` (status-conditional). */
@Injectable()
export class PrivacyNoticeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The next version number to use for this touchpoint — 1 if none exist
   * yet. Racy by construction (see `create()`'s P2002 handling at the
   * service layer, the `RetentionScheduleItem`/`rfq.service.ts` shape). */
  async nextVersionNumber(touchpoint: string): Promise<number> {
    const current = await this.prisma.client.privacyNotice.findFirst({
      where: { touchpoint },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    return (current?.versionNumber ?? 0) + 1;
  }

  create(input: CreatePrivacyNoticeInput): Promise<PrivacyNotice> {
    return this.prisma.client.privacyNotice.create({ data: input });
  }

  findById(id: string): Promise<PrivacyNotice | null> {
    return this.prisma.client.privacyNotice.findUnique({ where: { id } });
  }

  findMany(
    scope: { touchpoint?: string },
    take: number,
  ): Promise<PrivacyNotice[]> {
    return this.prisma.client.privacyNotice.findMany({
      where: { ...(scope.touchpoint ? { touchpoint: scope.touchpoint } : {}) },
      orderBy: [{ touchpoint: 'asc' }, { versionNumber: 'desc' }],
      take,
    });
  }

  /** The highest-versionNumber row for this touchpoint, or null if none
   * has ever been published. */
  findCurrent(touchpoint: string): Promise<PrivacyNotice | null> {
    return this.prisma.client.privacyNotice.findFirst({
      where: { touchpoint },
      orderBy: { versionNumber: 'desc' },
    });
  }

  /** Status-conditional — only stamps an unreviewed notice. 0 rows means
   * it was already legally reviewed. */
  recordLegalReview(
    id: string,
    legallyReviewedAt: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.privacyNotice.updateMany({
      where: { id, legallyReviewedAt: null },
      data: { legallyReviewedAt },
    });
  }
}
