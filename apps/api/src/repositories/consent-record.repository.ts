import { Injectable } from '@nestjs/common';
import type { ConsentRecord, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * M03 — Consent Management (backlog Part D §5.1). Owns the `ConsentRecord`
 * rows, wrapping `PrismaService` (services depend on repositories in this
 * codebase, never on Prisma directly). Reads used by `#44`'s marketing gate
 * live in `communication.repository.ts` (that module only *reads* consent;
 * this one owns the capture / withdrawal writes).
 *
 * `withdrawnAt` moves are status-conditional `updateMany`s (never a bare
 * `.withdrawnAt =` — `ibms-brain/meta/lex/race-safe-invariants.md`); a
 * 0-row result means the record was already withdrawn, or was never
 * granted.
 */
@Injectable()
export class ConsentRecordRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  leadExists(leadId: string): Promise<boolean> {
    return this.prisma.client.lead
      .count({ where: { id: leadId } })
      .then((n) => n > 0);
  }

  create(input: {
    customerId: string | null;
    insuredPersonId: string | null;
    leadId: string | null;
    purpose: string;
    isMarketing: boolean;
    granted: boolean;
    consentTextVersion: string;
    grantedAt: Date | null;
  }): Promise<ConsentRecord> {
    return this.prisma.client.consentRecord.create({
      data: {
        customerId: input.customerId,
        insuredPersonId: input.insuredPersonId,
        leadId: input.leadId,
        purpose: input.purpose as ConsentRecord['purpose'],
        isMarketing: input.isMarketing,
        granted: input.granted,
        consentTextVersion: input.consentTextVersion,
        grantedAt: input.grantedAt,
      },
    });
  }

  findById(id: string): Promise<ConsentRecord | null> {
    return this.prisma.client.consentRecord.findUnique({ where: { id } });
  }

  /**
   * The three consent counts the DPO workspace reports, computed by the
   * database over EVERY row rather than by scanning a capped page and counting
   * in memory.
   *
   * The old shape read the 1,000 most recent records and tallied them, which
   * silently under-reported the moment the table passed that many — it already
   * had. A compliance figure that quietly describes a subset of the records is
   * worse than one that is expensive, and three counts are neither.
   *
   * The three buckets partition the table exactly, mirroring
   * `deriveConsentView`'s `isActive = granted && withdrawnAt === null`:
   * active (granted, not withdrawn), withdrawn (withdrawnAt set, whatever
   * `granted` says), declined (never granted, never withdrawn).
   *
   * One interactive transaction, so the three counts are a single consistent
   * snapshot — the capped scan they replace was at least that, and three
   * independent reads would not be.
   */
  countByConsentState(): Promise<{
    activeCount: number;
    withdrawnCount: number;
    declinedCount: number;
  }> {
    return this.prisma.client.$transaction(async (tx) => {
      const activeCount = await tx.consentRecord.count({
        where: { granted: true, withdrawnAt: null },
      });
      const withdrawnCount = await tx.consentRecord.count({
        where: { withdrawnAt: { not: null } },
      });
      const declinedCount = await tx.consentRecord.count({
        where: { granted: false, withdrawnAt: null },
      });
      return { activeCount, withdrawnCount, declinedCount };
    });
  }

  findMany(
    scope: {
      customerId?: string;
      insuredPersonId?: string;
      leadId?: string;
      purpose?: string;
      granted?: boolean;
    },
    take: number,
  ): Promise<ConsentRecord[]> {
    return this.prisma.client.consentRecord.findMany({
      where: {
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
        ...(scope.insuredPersonId
          ? { insuredPersonId: scope.insuredPersonId }
          : {}),
        ...(scope.leadId ? { leadId: scope.leadId } : {}),
        ...(scope.purpose
          ? { purpose: scope.purpose as ConsentRecord['purpose'] }
          : {}),
        ...(scope.granted !== undefined ? { granted: scope.granted } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** `granted -> withdrawn`, stamping `withdrawnAt`. Status-conditional — 0
   * rows means the record was already withdrawn, or `granted` was never
   * true to begin with. */
  recordWithdrawal(
    id: string,
    withdrawnAt: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.consentRecord.updateMany({
      where: { id, granted: true, withdrawnAt: null },
      data: { withdrawnAt },
    });
  }
}
