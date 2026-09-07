import { Injectable } from '@nestjs/common';
import type { Prisma, ReconciliationException } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/** Cap on a book-wide `ReconciliationException` list. */
export const RECON_EXCEPTION_READ_LIMIT = 5000;

/**
 * Process 39 — Bank Reconciliation (backlog Part C #39, Domain D). Owns the
 * `ReconciliationException` rows, wrapping `PrismaService` (services depend on
 * repositories in this codebase, never on Prisma directly).
 *
 * Race backstop (`ibms-brain/meta/lex/race-safe-invariants.md`): the partial
 * `UNIQUE ("invoiceId") WHERE "status" <> 'resolved' AND "invoiceId" IS NOT
 * NULL` (migration `20260903150000`) makes "at most one non-resolved exception
 * per invoice" structural; `P2002` surfaces to the service as a resume-or-409.
 */
@Injectable()
export class ReconciliationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The one non-resolved exception for an invoice (or null) — mirrors the
   * partial UNIQUE index. */
  findOpenExceptionForInvoice(
    invoiceId: string,
  ): Promise<ReconciliationException | null> {
    return this.prisma.client.reconciliationException.findFirst({
      where: { invoiceId, status: { not: 'resolved' } },
    });
  }

  createException(input: {
    invoiceId: string | null;
    insurerStatementAmount: Prisma.Decimal;
    brokerRecordAmount: Prisma.Decimal;
    varianceAmount: Prisma.Decimal;
    raisedByUserId: string;
  }): Promise<ReconciliationException> {
    return this.prisma.client.reconciliationException.create({
      data: {
        invoiceId: input.invoiceId,
        insurerStatementAmount: input.insurerStatementAmount,
        brokerRecordAmount: input.brokerRecordAmount,
        varianceAmount: input.varianceAmount,
        status: 'open',
        raisedByUserId: input.raisedByUserId,
      },
    });
  }

  findExceptionById(id: string): Promise<ReconciliationException | null> {
    return this.prisma.client.reconciliationException.findUnique({
      where: { id },
    });
  }

  findExceptions(
    scope: { invoiceId?: string; status?: string },
    take: number,
  ): Promise<ReconciliationException[]> {
    return this.prisma.client.reconciliationException.findMany({
      where: {
        ...(scope.invoiceId ? { invoiceId: scope.invoiceId } : {}),
        ...(scope.status ? { status: scope.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** `open -> investigating`, stamping the investigator. Status-conditional —
   * 0 rows means it was already past `open`. */
  recordInvestigation(
    id: string,
    investigatedByUserId: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.reconciliationException.updateMany({
      where: { id, status: 'open' },
      data: { status: 'investigating', investigatedByUserId },
    });
  }

  /** `{open|investigating} -> resolved`, stamping the closer + the mandatory
   * `resolutionNote` + `resolvedAt`. Status-conditional — 0 rows means it was
   * already `resolved`. */
  recordResolution(
    id: string,
    input: { resolutionNote: string; resolvedByUserId: string },
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.reconciliationException.updateMany({
      where: { id, status: { in: ['open', 'investigating'] } },
      data: {
        status: 'resolved',
        resolvedByUserId: input.resolvedByUserId,
        resolutionNote: input.resolutionNote,
        resolvedAt: new Date(),
      },
    });
  }
}
