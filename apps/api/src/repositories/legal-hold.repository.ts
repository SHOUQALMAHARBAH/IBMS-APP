import { Injectable } from '@nestjs/common';
import type { LegalHold, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateLegalHoldInput {
  scope: string;
  reason: string;
  nextReviewDueAt: Date;
  retentionScheduleItemId: string | null;
  customerId: string | null;
  insuredPersonId: string | null;
}

export interface LegalHoldFilter {
  retentionScheduleItemId?: string;
  active?: boolean;
  customerId?: string;
  insuredPersonId?: string;
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

  customerExists(customerId: string): Promise<boolean> {
    return this.prisma.client.customer
      .count({ where: { id: customerId } })
      .then((n) => n > 0);
  }

  insuredPersonExists(insuredPersonId: string): Promise<boolean> {
    return this.prisma.client.insuredPerson
      .count({ where: { id: insuredPersonId } })
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
        customerId: filter.customerId,
        insuredPersonId: filter.insuredPersonId,
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

  /** Is there any currently-ACTIVE Legal Hold naming this exact data
   * subject (by `customerId` or `insuredPersonId`)? The live check behind
   * `DsrService.fulfil()`'s DELETION gate — `M04`'s "never closeable while
   * a retention flag is open" against THIS register, not a staff
   * attestation alone. A hold with neither subject reference set (the
   * pre-widening, category-only shape) cannot match any subject here —
   * that gap remains a documented, honest limitation, not a false
   * negative this method silently hides. */
  hasActiveHoldForSubject(input: {
    customerId: string | null;
    insuredPersonId: string | null;
  }): Promise<boolean> {
    if (!input.customerId && !input.insuredPersonId) {
      return Promise.resolve(false);
    }
    return this.prisma.client.legalHold
      .count({
        where: {
          releasedAt: null,
          OR: [
            ...(input.customerId ? [{ customerId: input.customerId }] : []),
            ...(input.insuredPersonId
              ? [{ insuredPersonId: input.insuredPersonId }]
              : []),
          ],
        },
      })
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
