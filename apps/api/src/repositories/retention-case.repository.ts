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
   * actually due. Unpaginated, the #12 / #27 follow-up-sweep precedent — a
   * deliberate volume deferral, moot today since the renewal module (Part
   * 3.9) that would populate this table is not built. */
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

  /**
   * The sweep's stamp-then-create, in ONE interactive transaction (a
   * deliberate local exception to this codebase's no-`$transaction`
   * convention, like `claim.repository.ts#createNotification` /
   * `quotation.repository.ts` / `policy.repository.ts`). Two things a
   * non-transactional version got wrong (`@code-reviewer` BLOCKER + MAJOR on
   * the first pass):
   *
   *   1. If `retentionCase.create` failed *after* a successful stamp, the
   *      `RenewalCase` would be left permanently marked escalated
   *      (`retentionEscalatedAt` non-null) with no `RetentionCase` ever
   *      created — `findRenewalCasesForSweep` would never reconsider it
   *      again. Wrapping both writes in one transaction means a failed
   *      `create` rolls the stamp back too, so the row stays eligible for
   *      the next run.
   *   2. The stamp's `where` re-asserts `status NOT IN (RENEWED, CANCELLED)`
   *      — not just `retentionEscalatedAt: null` — so a `RenewalCase` that
   *      concludes successfully *between* the sweep's load and this write
   *      (a live race once the renewal module exists) yields 0 rows here
   *      instead of opening a spurious case for a customer who just renewed
   *      (`ibms-brain/meta/lex/race-safe-invariants.md` — re-assert every
   *      field the caller's decision depended on, not only the guard
   *      column).
   *
   * Returns the created `RetentionCase`, or `null` when this run lost the
   * race (the stamp's `where` matched 0 rows — already escalated, or
   * concluded mid-flight).
   */
  escalateAndCreateRetentionCase(input: {
    renewalCaseId: string;
    escalatedAt: Date;
    customerId: string;
    reason: string;
  }): Promise<RetentionCase | null> {
    return this.prisma.client.$transaction(async (tx) => {
      const stamped = await tx.renewalCase.updateMany({
        where: {
          id: input.renewalCaseId,
          retentionEscalatedAt: null,
          status: { notIn: ['RENEWED', 'CANCELLED'] },
        },
        data: { retentionEscalatedAt: input.escalatedAt },
      });
      if (stamped.count === 0) return null;

      return tx.retentionCase.create({
        data: {
          customerId: input.customerId,
          reason: input.reason,
          status: 'open',
        },
      });
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
