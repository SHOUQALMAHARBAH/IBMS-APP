import { Injectable } from '@nestjs/common';
import type { Prisma, TransactionMonitoringAlert } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateTransactionMonitoringAlertInput {
  customerId: string | null;
  patternType: string;
  detailText: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
}

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
  constructor(private readonly prisma: PrismaService) {}

  customerExists(customerId: string): Promise<boolean> {
    return this.prisma.client.customer
      .count({ where: { id: customerId } })
      .then((n) => n > 0);
  }

  create(
    input: CreateTransactionMonitoringAlertInput,
  ): Promise<TransactionMonitoringAlert> {
    return this.prisma.client.transactionMonitoringAlert.create({
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

  findById(id: string): Promise<TransactionMonitoringAlert | null> {
    return this.prisma.client.transactionMonitoringAlert.findUnique({
      where: { id },
    });
  }

  findMany(
    scope: TransactionMonitoringAlertScope,
    take: number,
  ): Promise<TransactionMonitoringAlert[]> {
    return this.prisma.client.transactionMonitoringAlert.findMany({
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
   * precedent — a deliberate volume deferral. */
  findReceiptsForSweep(): Promise<ReceiptForSweep[]> {
    return this.prisma.client.receipt.findMany({
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
