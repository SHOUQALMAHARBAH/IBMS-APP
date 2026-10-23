import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { RetentionArchiveRepository } from './retention-archive.repository';
import { notBlockedWhere } from '../modules/pdpl/retention-archive.config';

export interface CreateTransactionMonitoringAlertInput {
  customerId: string | null;
  patternType: string;
  detailText: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
}

/*
 * RULE 2 — WHOSE TRANSACTIONS TRIPPED THE PATTERN, BY NAME. The alert queue's Customer column
 * rendered the first eight characters of a uuid, which identifies nobody — and on an AML queue that
 * is the column the whole screen is about.
 *
 * `Customer.legalName` is NOT NULL, so whenever an alert names a customer there is a name to show.
 * The RELATION is optional (`customerId String?`), so the projected name is nullable and that null
 * is a real state rather than dead code.
 *
 * `AlertWithCustomer` derives from this object, so the type widens with it and names every site.
 */
export const WITH_CUSTOMER = {
  include: {
    customer: { select: { legalName: true } },
  },
} as const;

export type AlertWithCustomer = Prisma.TransactionMonitoringAlertGetPayload<
  typeof WITH_CUSTOMER
>;

export interface TransactionMonitoringAlertScope {
  customerId?: string;
  patternType?: string;
  status?: string;
  escalatedToSuspiciousActivity?: boolean;
}

/** A `Receipt` reduced to what the sweep's pure classifiers
 * (`transaction-monitoring.config.ts`) need. */
export interface ReceiptForSweep {
  id: string;
  invoice: { id: string; customerId: string; premiumAmount: Prisma.Decimal };
  paymentChannel: { ownerType: string; customerId: string | null } | null;
}

/** A `Cancellation`/`Refund` row reduced to which customer and when — both
 * only ever reached via `Endorsement.policy.customerId`, neither carries a
 * `customerId` column of its own. */
export interface DatedCustomerEventRow {
  customerId: string;
  createdAt: Date;
}

/**
 * Process 48 — AML/CFT Transaction Monitoring (backlog Part C #48, Domain
 * F). Owns `TransactionMonitoringAlert` reads/writes, plus the cross-module
 * reads the detection sweep needs (`Receipt`/`Cancellation`/`Refund`, none
 * of which belong to this module). Wraps `PrismaService` (services depend on
 * repositories in this codebase, never on Prisma directly).
 */
@Injectable()
export class TransactionMonitoringAlertRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly archive: RetentionArchiveRepository,
  ) {}

  customerExists(customerId: string): Promise<boolean> {
    return this.prisma.client.customer
      .count({ where: { id: customerId } })
      .then((n) => n > 0);
  }

  create(
    input: CreateTransactionMonitoringAlertInput,
  ): Promise<AlertWithCustomer> {
    return this.prisma.client.transactionMonitoringAlert.create({
      ...WITH_CUSTOMER,
      data: {
        customerId: input.customerId,
        patternType: input.patternType,
        detailText: input.detailText,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        status: 'open',
      },
    });
  }

  findById(id: string): Promise<AlertWithCustomer | null> {
    return this.prisma.client.transactionMonitoringAlert.findUnique({
      where: { id },
      ...WITH_CUSTOMER,
    });
  }

  findMany(
    scope: TransactionMonitoringAlertScope,
    take: number,
  ): Promise<AlertWithCustomer[]> {
    return this.prisma.client.transactionMonitoringAlert.findMany({
      ...WITH_CUSTOMER,
      where: {
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
        ...(scope.patternType ? { patternType: scope.patternType } : {}),
        ...(scope.status ? { status: scope.status } : {}),
        ...(scope.escalatedToSuspiciousActivity !== undefined
          ? {
              escalatedToSuspiciousActivity:
                scope.escalatedToSuspiciousActivity,
            }
          : {}),
      },
      orderBy: { detectedAt: 'desc' },
      take,
    });
  }

  /** Every already-alerted `(patternType, sourceEntityId)` pair among the
   * event-scoped patterns — the sweep's pre-check so it doesn't re-alert a
   * `Receipt` it already flagged (the partial-unique index, migration
   * 20260904130000, is the real race backstop). */
  findExistingSourceAlertKeys(
    patternTypes: readonly string[],
  ): Promise<{ patternType: string; sourceEntityId: string | null }[]> {
    return this.prisma.client.transactionMonitoringAlert.findMany({
      where: {
        patternType: { in: [...patternTypes] },
        sourceEntityId: { not: null },
      },
      select: { patternType: true, sourceEntityId: true },
    });
  }

  /** Whether an OPEN aggregate alert (no `sourceEntityId`) already exists
   * for this customer/pattern — the sweep's pre-check for the two
   * customer-level patterns, backed by the same-shaped partial-unique index. */
  hasOpenAggregateAlert(
    customerId: string,
    patternType: string,
  ): Promise<boolean> {
    return this.prisma.client.transactionMonitoringAlert
      .count({
        where: {
          customerId,
          patternType,
          status: 'open',
          sourceEntityId: null,
        },
      })
      .then((n) => n > 0);
  }

  /** Every `Receipt` — a real client payment collected (#32) — with just
   * enough of its `Invoice` and `PaymentChannel` for
   * `detectReceiptPatterns()`. Unpaginated, the #12/#27 follow-up-sweep
   * precedent — a deliberate volume deferral.
   *
   * EXCEPT THE BLOCKED ONES (batch 5 group 7c, condition 1). This is the sharpest of the three
   * unbounded reads the archived state had to close: a scheduled AML sweep reading a receipt past
   * both the five-year AML floor and the ten-year commercial one is literally the "ongoing
   * processing" a legal block forbids. A held or extended record is NOT blocked and stays in the
   * sweep — `notBlockedWhere` is the one place that distinction lives. */
  async findReceiptsForSweep(
    now: Date = new Date(),
  ): Promise<ReceiptForSweep[]> {
    const blocked = await this.archive.blockedExclusionForModel('receipt', now);
    return this.prisma.client.receipt.findMany({
      where: notBlockedWhere('receivedAt', blocked),
      select: {
        id: true,
        invoice: {
          select: { id: true, customerId: true, premiumAmount: true },
        },
        paymentChannel: { select: { ownerType: true, customerId: true } },
      },
    });
  }

  async findCancellationsSince(
    windowStart: Date,
  ): Promise<DatedCustomerEventRow[]> {
    const rows = await this.prisma.client.cancellation.findMany({
      where: { createdAt: { gte: windowStart } },
      select: {
        createdAt: true,
        endorsement: { select: { policy: { select: { customerId: true } } } },
      },
    });
    return rows.map((r) => ({
      customerId: r.endorsement.policy.customerId,
      createdAt: r.createdAt,
    }));
  }

  async findRefundsSince(windowStart: Date): Promise<DatedCustomerEventRow[]> {
    const rows = await this.prisma.client.refund.findMany({
      where: { createdAt: { gte: windowStart } },
      select: {
        createdAt: true,
        endorsement: { select: { policy: { select: { customerId: true } } } },
      },
    });
    return rows.map((r) => ({
      customerId: r.endorsement.policy.customerId,
      createdAt: r.createdAt,
    }));
  }

  /** `open -> {escalated flag set}`. Status-conditional on both `status`
   * (can't escalate a closed alert) and the flag itself (idempotent — 0 rows
   * means already escalated, the caller treats that as a no-op). */
  recordEscalation(
    id: string,
    escalatedAt: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.transactionMonitoringAlert.updateMany({
      where: { id, status: 'open', escalatedToSuspiciousActivity: false },
      data: { escalatedToSuspiciousActivity: true, escalatedAt },
    });
  }

  /** Stamps `reportedToAuthorityAt` — the record-keeping evidence a
   * suspicious-activity report was actually filed. Status-conditional on
   * `escalatedToSuspiciousActivity: true` (report follows escalation, never
   * the other way round) and `reportedToAuthorityAt: null` (idempotent). */
  recordReportToAuthority(
    id: string,
    reportedAt: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.transactionMonitoringAlert.updateMany({
      where: {
        id,
        escalatedToSuspiciousActivity: true,
        reportedToAuthorityAt: null,
      },
      data: { reportedToAuthorityAt: reportedAt },
    });
  }

  /** `open -> closed`. Status-conditional — 0 rows means already closed. No
   * `closedAt` column exists on this model (unlike `RetentionCase`) — the
   * `UPDATE` `AuditLogEntry.occurredAt` is the closure timestamp of record. */
  recordClosure(id: string): Promise<Prisma.BatchPayload> {
    return this.prisma.client.transactionMonitoringAlert.updateMany({
      where: { id, status: 'open' },
      data: { status: 'closed' },
    });
  }
}
