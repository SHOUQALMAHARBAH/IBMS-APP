import { Injectable } from '@nestjs/common';
import type { Prisma, RenewalStatus, RetentionCase } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/** A `RenewalCase` not yet escalated to retention, with just enough of its
 * parent `Policy` to resolve the customer it belongs to. */
export interface RenewalCaseForSweep {
  id: string;
  status: RenewalStatus;
  triggeredAt: Date;
  policy: { customerId: string };
}

export interface CreateRetentionCaseInput {
  customerId: string;
  reason: string;
}

export interface RetentionCaseScope {
  customerId?: string;
  status?: string;
  reason?: string;
}

/**
 * Process 46 — Customer Retention (backlog Part C #46, Domain E). Owns
 * `RetentionCase` reads/writes, plus the `RenewalCase` sweep read + the
 * race-safe `retentionEscalatedAt` stamp the detection sweep relies on.
 * Wraps `PrismaService` (services depend on repositories in this codebase,
 * never on Prisma directly).
 *
 * `RenewalCase.status` is NEVER written here — only `retentionEscalatedAt`
 * (a side column, the `RfqInsurer.followUpAlertSentAt` shape): the retention
 * sweep observes the renewal lifecycle, it never drives it.
 */
@Injectable()
export class RetentionCaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  customerExists(customerId: string): Promise<boolean> {
    return this.prisma.client.customer
      .count({ where: { id: customerId } })
      .then((n) => n > 0);
  }

  /** Every `RenewalCase` not yet escalated to retention and whose renewal
   * cycle has not concluded (`RENEWED` / `CANCELLED` are excluded here —
   * `LAPSED` is deliberately left in, it is a trigger, not a conclusion).
   * The pure `classifyRenewalCaseForRetention` decides which of these are
   * actually due. */
  findRenewalCasesForSweep(): Promise<RenewalCaseForSweep[]> {
    return this.prisma.client.renewalCase.findMany({
      where: {
        retentionEscalatedAt: null,
        status: { notIn: ['RENEWED', 'CANCELLED'] },
      },
      select: {
        id: true,
        status: true,
        triggeredAt: true,
        policy: { select: { customerId: true } },
      },
    });
  }

  /** Race-safe: conditional on `retentionEscalatedAt` still being null, so a
   * concurrent / re-run sweep only ever escalates a given `RenewalCase`
   * once (`ibms-brain/meta/lex/race-safe-invariants.md`). */
  stampRetentionEscalation(
    renewalCaseId: string,
    at: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.renewalCase.updateMany({
      where: { id: renewalCaseId, retentionEscalatedAt: null },
      data: { retentionEscalatedAt: at },
    });
  }

  create(input: CreateRetentionCaseInput): Promise<RetentionCase> {
    return this.prisma.client.retentionCase.create({
      data: {
        customerId: input.customerId,
        reason: input.reason,
        status: 'open',
      },
    });
  }

  findById(id: string): Promise<RetentionCase | null> {
    return this.prisma.client.retentionCase.findUnique({ where: { id } });
  }

  findMany(scope: RetentionCaseScope, take: number): Promise<RetentionCase[]> {
    return this.prisma.client.retentionCase.findMany({
      where: {
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
        ...(scope.status ? { status: scope.status } : {}),
        ...(scope.reason ? { reason: scope.reason } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** `open -> closed`, stamping `closedAt`. Status-conditional — 0 rows
   * means it was already closed. */
  recordClosure(id: string, closedAt: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.client.retentionCase.updateMany({
      where: { id, status: 'open' },
      data: { status: 'closed', closedAt },
    });
  }
}
