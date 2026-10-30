import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateLegalHoldInput {
  scope: string;
  reason: string;
  nextReviewDueAt: Date;
  retentionScheduleItemId: string | null;
  customerId: string | null;
  insuredPersonId: string | null;
}

/*
 * RULE 2 — WHOSE RECORDS ARE FROZEN, BY NAME. The hold register's Subject column rendered the first
 * eight characters of a uuid, which identifies nobody: a DPO reviewing holds every six months (the
 * `legal_hold_necessity_review` SLA) could not tell whose file each one covers.
 *
 * `Customer.legalName` is NOT NULL, so when a hold names a customer there is always a name to show.
 * The RELATION is optional, though, because a hold may legitimately name no subject at all and rely
 * on `scope`/`retentionScheduleItemId` — see `hasAtMostOneSubjectReference`. So this projects a
 * NULLABLE name, and the null case is a real state rather than dead code.
 *
 * `LegalHoldWithSubject` derives from this object, so the type widens with it and names every site.
 */
export const WITH_SUBJECT = {
  include: {
    customer: { select: { legalName: true } },
  },
} as const;

export type LegalHoldWithSubject = Prisma.LegalHoldGetPayload<
  typeof WITH_SUBJECT
>;

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

  create(input: CreateLegalHoldInput): Promise<LegalHoldWithSubject> {
    return this.prisma.client.legalHold.create({
      data: input,
      ...WITH_SUBJECT,
    });
  }

  findById(id: string): Promise<LegalHoldWithSubject | null> {
    return this.prisma.client.legalHold.findUnique({
      where: { id },
      ...WITH_SUBJECT,
    });
  }

  findMany(filter: LegalHoldFilter): Promise<LegalHoldWithSubject[]> {
    return this.prisma.client.legalHold.findMany({
      ...WITH_SUBJECT,
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

  /**
   * The active hold ITSELF, so a refusal can NAME it — batch 5 group 7b.
   *
   * `hasActiveHold` answers whether one exists, which is all the exclusion needed; the refusal that
   * stops a person destroying records needs to say WHICH hold stands and WHY, or the reader is told
   * only that something is in the way. Oldest-placed first, because when several stand the one that
   * has been there longest is the one somebody is most likely to have forgotten about.
   */
  findActiveHold(retentionScheduleItemId: string) {
    return this.prisma.client.legalHold.findFirst({
      where: { retentionScheduleItemId, releasedAt: null },
      orderBy: { placedAt: 'asc' },
      select: { id: true, scope: true, reason: true, placedAt: true },
    });
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
