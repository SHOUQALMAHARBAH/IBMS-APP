import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * MODULE 0 CLOSE — the sixteenth pair's act has to reach the RECORD, so every read carries it.
 *
 * Found by `combined-duty-projection.py` the moment that measurement could run again: this pair
 * was the one entry of sixteen WRITING the act and showing nobody, so a period one person both set
 * and confirmed under a declared COMBINED mode read as an ordinary two-person confirmation.
 */
export const RETENTION_SCHEDULE_ITEM_INCLUDE = {
  combinedDutyAct: true,
} satisfies Prisma.RetentionScheduleItemInclude;

/**
 * THE STRICT PAYLOAD TYPE, and it is the load-bearing half rather than decoration.
 *
 * `IncidentReport.load()` once declared the BARE model, so every read path through it projected
 * `undefined` while `create()` projected the act — a defect no test saw and the compiler could not
 * see either, because a missing relation on a bare model is not a type error. Declaring the
 * payload makes `tsc` name any read that forgets the include.
 */
export type RetentionScheduleItemWithCombinedDuty =
  Prisma.RetentionScheduleItemGetPayload<{
    include: typeof RETENTION_SCHEDULE_ITEM_INCLUDE;
  }>;

export interface CreateRetentionScheduleItemInput {
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis: string | null;
  /** MODULE 0 CLOSE, DECISION 3 — the MAKER. Required at the input boundary even though the column is
   *  nullable: the column is nullable for FOUR PRE-EXISTING ROWS nobody recorded an actor for, and
   *  every row written from here on has one. Optional here would make the maker half forgettable. */
  setByUserId: string;
}

export interface UpdateRetentionScheduleItemInput {
  retentionPeriodMonths?: number;
  legalBasis?: string | null;
  /** RE-STAMPED ON EVERY EDIT, not only on create. The maker is whoever last SET the period, because
   *  that is the person the confirmation must differ from — carrying the original creator forward
   *  would let A create, B edit, and B confirm their own figure. */
  setByUserId: string;
}

/** M06 — owns `RetentionScheduleItem` writes. `recordCategory` is a real
 * unique constraint (Process #52 widening) — `create()` lets a duplicate
 * category surface as the ordinary Prisma `P2002` the controller layer
 * already knows how to turn into a 409 elsewhere in this codebase, rather
 * than a pre-check-then-write race. */
@Injectable()
export class RetentionScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    input: CreateRetentionScheduleItemInput,
  ): Promise<RetentionScheduleItemWithCombinedDuty> {
    return this.prisma.client.retentionScheduleItem.create({
      data: input,
      include: RETENTION_SCHEDULE_ITEM_INCLUDE,
    });
  }

  findById(id: string): Promise<RetentionScheduleItemWithCombinedDuty | null> {
    return this.prisma.client.retentionScheduleItem.findUnique({
      where: { id },
      include: RETENTION_SCHEDULE_ITEM_INCLUDE,
    });
  }

  /** `findFirst`, not `findUnique`: multi-tenancy Phase 1 step 5 moved the
   * UNIQUE to (organizationId, recordCategory), because each office keeps its
   * OWN PDPL retention schedule — a global unique on `recordCategory` meant
   * only one office on the platform could have a "customer_kyc" row at all.
   * Equivalent while one Organization exists. PHASE 2 must scope this to the
   * resolved organizationId and restore a unique read. */
  findByRecordCategory(
    recordCategory: string,
  ): Promise<RetentionScheduleItemWithCombinedDuty | null> {
    return this.prisma.client.retentionScheduleItem.findFirst({
      where: { recordCategory },
      include: RETENTION_SCHEDULE_ITEM_INCLUDE,
    });
  }

  findMany(): Promise<RetentionScheduleItemWithCombinedDuty[]> {
    return this.prisma.client.retentionScheduleItem.findMany({
      orderBy: { recordCategory: 'asc' },
      include: RETENTION_SCHEDULE_ITEM_INCLUDE,
    });
  }

  update(
    id: string,
    input: UpdateRetentionScheduleItemInput,
  ): Promise<RetentionScheduleItemWithCombinedDuty> {
    return this.prisma.client.retentionScheduleItem.update({
      where: { id },
      data: input,
      include: RETENTION_SCHEDULE_ITEM_INCLUDE,
    });
  }

  /** Status-conditional — `confirmedByLegalCounselAt IS NULL` re-asserted
   * in the `where`, the race-safe-invariants shape, since confirmation is a
   * one-time legal act, not an editable field. 0 rows means it was already
   * confirmed. */
  confirm(
    id: string,
    confirmedAt: Date,
    confirmedByUserId: string,
    combinedDutyActId: string | null,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.retentionScheduleItem.updateMany({
      where: { id, confirmedByLegalCounselAt: null },
      data: {
        confirmedByLegalCounselAt: confirmedAt,
        /* THE ACTOR THE DATE NEVER HAD. `RetentionScheduleItem_confirmation_carries_its_actor`
         * refuses one without the other going forward, so these two move together by construction. */
        confirmedByLegalCounselByUserId: confirmedByUserId,
        /* NULL for every ordinary two-person confirmation; an act id only when the office has
         * DECLARED merged duties and the engine resolved one. Passing it is not optional — the CHECK
         * refuses a self-confirmation whose escape column is null, so dropping this argument turns a
         * declared combined act into a 500. That is the backstop working, and it is why the engine's
         * return value is threaded rather than discarded. */
        combinedDutyActId,
      },
    });
  }
}
