import { Injectable } from '@nestjs/common';
import type { Prisma, RetentionScheduleItem } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateRetentionScheduleItemInput {
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis: string | null;
}

export interface UpdateRetentionScheduleItemInput {
  retentionPeriodMonths?: number;
  legalBasis?: string | null;
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
  ): Promise<RetentionScheduleItem> {
    return this.prisma.client.retentionScheduleItem.create({ data: input });
  }

  findById(id: string): Promise<RetentionScheduleItem | null> {
    return this.prisma.client.retentionScheduleItem.findUnique({
      where: { id },
    });
  }

  findByRecordCategory(
    recordCategory: string,
  ): Promise<RetentionScheduleItem | null> {
    return this.prisma.client.retentionScheduleItem.findUnique({
      where: { recordCategory },
    });
  }

  findMany(): Promise<RetentionScheduleItem[]> {
    return this.prisma.client.retentionScheduleItem.findMany({
      orderBy: { recordCategory: 'asc' },
    });
  }

  update(
    id: string,
    input: UpdateRetentionScheduleItemInput,
  ): Promise<RetentionScheduleItem> {
    return this.prisma.client.retentionScheduleItem.update({
      where: { id },
      data: input,
    });
  }

  /** Status-conditional — `confirmedByLegalCounselAt IS NULL` re-asserted
   * in the `where`, the race-safe-invariants shape, since confirmation is a
   * one-time legal act, not an editable field. 0 rows means it was already
   * confirmed. */
  confirm(id: string, confirmedAt: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.client.retentionScheduleItem.updateMany({
      where: { id, confirmedByLegalCounselAt: null },
      data: { confirmedByLegalCounselAt: confirmedAt },
    });
  }
}
