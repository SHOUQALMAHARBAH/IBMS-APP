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

  create(input: {
    customerId: string | null;
    insuredPersonId: string | null;
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

  findMany(
    scope: {
      customerId?: string;
      insuredPersonId?: string;
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
