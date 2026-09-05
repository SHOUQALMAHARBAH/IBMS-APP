import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { TransactionMonitoringAlertRepository } from '../../repositories/transaction-monitoring-alert.repository';
import { applyDuration } from '../../common/business-days.util';
import {
  AML_FREQUENT_CANCELLATION_LOOKBACK_DAYS,
  AML_FREQUENT_CANCELLATION_THRESHOLD_COUNT,
  AML_FREQUENT_REFUND_LOOKBACK_DAYS,
  AML_FREQUENT_REFUND_THRESHOLD_COUNT,
  RECEIPT_SCOPED_PATTERN_TYPES,
  TRANSACTION_MONITORING_READ_LIMIT,
  buildFrequentCancellationDetail,
  buildFrequentRefundDetail,
  countRecentByCustomer,
  deriveTransactionMonitoringAlertView,
  detectReceiptPatterns,
  isFrequentPattern,
  transactionMonitoringAlertAuditSnapshot,
  type TransactionMonitoringAlertView,
} from './transaction-monitoring.config';
import type { CreateTransactionMonitoringAlertDto } from './dto/create-transaction-monitoring-alert.dto';
import type { ListTransactionMonitoringAlertsQueryDto } from './dto/list-transaction-monitoring-alerts-query.dto';

export interface TransactionMonitoringSweepResult {
  scanned: number;
  created: number;
  /** Classified as a hit, but an alert already exists (this run's own
   * pre-check, or the DB unique index rejected a concurrent duplicate) —
   * distinct from `failed` (a genuine error). */
  skippedExisting: number;
  failed: number;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Process 48 — AML/CFT Transaction Monitoring (backlog Part C #48, Domain F
 * — opens Compliance & Risk beyond KYC). Two checkboxes:
 *
 *   1. Monitor unusual patterns — `runSweep` (nightly + on-demand) detects
 *      four patterns over existing Finance/Endorsement data: an
 *      unusually large premium payment or a third-party payment source (both
 *      per-`Receipt`, event-scoped), and frequent cancellations or frequent
 *      refunds (both per-customer, a rolling-window count) — plus a manual
 *      `create` for anything Compliance notices that machine detection
 *      doesn't cover (`patternType: 'other'`).
 *   2. A suspicious-activity escalation path + record-keeping — `escalate`
 *      (internal decision) then `reportToAuthority` (the external filing),
 *      two separate steps like M03's consent-withdrawal request/confirm —
 *      an internal escalation that was never actually reported is a
 *      meaningfully different fact than one that was. Record-keeping is the
 *      row itself (`reportedToAuthorityAt` + the audit trail): no delete
 *      endpoint exists anywhere on this model.
 *
 * `TransactionMonitoringAlert.status` is a plain string (`open`/`closed`) —
 * NOT a `WorkflowTransitionService` entity, no maker/checker (`aml.monitor`
 * / `aml.escalate` are both single-role COMPLIANCE grants — the #42
 * `complaint.escalate` shape, not the #23-#28 claim-settlement shape), no
 * `SlaTimer` (the backlog names no filing deadline the way M03's "2 business
 * days" was explicit — see `ibms-brain/meta/context/transaction-monitoring.md`
 * for what's deferred).
 */
@Injectable()
export class TransactionMonitoringService {
  private readonly logger = new Logger(TransactionMonitoringService.name);

  constructor(
    private readonly repo: TransactionMonitoringAlertRepository,
    private readonly audit: AuditService,
  ) {}

  // --- 1. manual log ----------------------------------------------------

  async create(
    dto: CreateTransactionMonitoringAlertDto,
    actorUserId: string,
  ): Promise<TransactionMonitoringAlertView> {
    if (dto.customerId && !(await this.repo.customerExists(dto.customerId))) {
      throw new NotFoundException(`Customer ${dto.customerId} not found.`);
    }

    // Only the two aggregate patterns (frequent_cancellations /
    // frequent_refunds) can conflict on the partial unique index — a manual
    // log never sets sourceEntityId, so the event-scoped patterns (including
    // 'other') never collide with each other or with a sweep-created row.
    let row: Awaited<ReturnType<typeof this.repo.create>>;
    try {
      row = await this.repo.create({
        customerId: dto.customerId ?? null,
        patternType: dto.patternType,
        detailText: dto.detailText ?? null,
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        throw new ConflictException(
          `An open ${dto.patternType} alert already exists for this customer — close it before logging another.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'TransactionMonitoringAlert',
      entityId: row.id,
      afterValue: transactionMonitoringAlertAuditSnapshot({
        alertId: row.id,
        customerId: row.customerId,
        patternType: row.patternType,
        status: row.status,
      }),
      isSensitiveDataAccess: true,
    });

    return deriveTransactionMonitoringAlertView(row);
  }

  // --- 2. the detection sweep (backlog Part C #48's first checkbox) -----

  /** Shared by the nightly `TransactionMonitoringSweepScheduler` and the
   * on-demand `POST /transaction-monitoring-alerts/detect`. Per-candidate
   * isolation — one bad row must not abandon the rest of the sweep (the
   * #9/#12/#27/#46 shape). */
  async runSweep(
    actorUserId: string,
  ): Promise<TransactionMonitoringSweepResult> {
    const now = new Date();
    let created = 0;
    let skippedExisting = 0;
    let failed = 0;

    // --- receipt-scoped patterns: large_premium_payment, third_party_payment_source
    const receipts = await this.repo.findReceiptsForSweep();
    const existingSourceKeys = new Set(
      (
        await this.repo.findExistingSourceAlertKeys(
          RECEIPT_SCOPED_PATTERN_TYPES,
        )
      ).map((r) => `${r.patternType}:${r.sourceEntityId}`),
    );

    for (const receipt of receipts) {
      for (const candidate of detectReceiptPatterns(receipt)) {
        const key = `${candidate.patternType}:${candidate.sourceEntityId}`;
        if (existingSourceKeys.has(key)) {
          skippedExisting += 1;
          continue;
        }
        try {
          const row = await this.repo.create(candidate);
          existingSourceKeys.add(key);
          created += 1;
          await this.safeAudit({
            userId: actorUserId,
            action: 'CREATE',
            entityType: 'TransactionMonitoringAlert',
            entityId: row.id,
            afterValue: transactionMonitoringAlertAuditSnapshot({
              alertId: row.id,
              customerId: row.customerId,
              patternType: row.patternType,
              status: row.status,
              sourceEntityType: row.sourceEntityType,
              sourceEntityId: row.sourceEntityId,
            }),
            isSensitiveDataAccess: true,
          });
        } catch (err) {
          if (isUniqueConstraintViolation(err)) {
            skippedExisting += 1; // a concurrent sweep flagged this Receipt first
            continue;
          }
          failed += 1;
          this.logger.error(
            `Transaction-monitoring sweep: ${candidate.patternType} on Receipt ${receipt.id} failed (${(err as Error).message}) — continuing.`,
          );
        }
      }
    }

    // --- aggregate patterns: frequent_cancellations, frequent_refunds
    const cancellationWindowStart = applyDuration(now, {
      value: -AML_FREQUENT_CANCELLATION_LOOKBACK_DAYS,
      unit: 'calendarDays',
    });
    const cancellations = await this.repo.findCancellationsSince(
      cancellationWindowStart,
    );
    const cancellationCounts = countRecentByCustomer(
      cancellations,
      cancellationWindowStart,
    );
    const cancellationResult = await this.createAggregateAlerts(
      cancellationCounts,
      AML_FREQUENT_CANCELLATION_THRESHOLD_COUNT,
      'frequent_cancellations',
      (count) =>
        buildFrequentCancellationDetail(
          count,
          AML_FREQUENT_CANCELLATION_LOOKBACK_DAYS,
        ),
      actorUserId,
    );

    const refundWindowStart = applyDuration(now, {
      value: -AML_FREQUENT_REFUND_LOOKBACK_DAYS,
      unit: 'calendarDays',
    });
    const refunds = await this.repo.findRefundsSince(refundWindowStart);
    const refundCounts = countRecentByCustomer(refunds, refundWindowStart);
    const refundResult = await this.createAggregateAlerts(
      refundCounts,
      AML_FREQUENT_REFUND_THRESHOLD_COUNT,
      'frequent_refunds',
      (count) =>
        buildFrequentRefundDetail(count, AML_FREQUENT_REFUND_LOOKBACK_DAYS),
      actorUserId,
    );

    created += cancellationResult.created + refundResult.created;
    skippedExisting +=
      cancellationResult.skippedExisting + refundResult.skippedExisting;
    failed += cancellationResult.failed + refundResult.failed;

    return {
      // Row counts throughout — receipts examined + cancellations examined +
      // refunds examined (NOT distinct-customer counts, a MINOR fix: the
      // first pass used cancellationCounts.size/refundCounts.size here,
      // undercounting whenever any customer had more than one row in the
      // window).
      scanned: receipts.length + cancellations.length + refunds.length,
      created,
      skippedExisting,
      failed,
    };
  }

  private async createAggregateAlerts(
    counts: Map<string, number>,
    threshold: number,
    patternType: 'frequent_cancellations' | 'frequent_refunds',
    detailFor: (count: number) => string,
    actorUserId: string,
  ): Promise<{ created: number; skippedExisting: number; failed: number }> {
    let created = 0;
    let skippedExisting = 0;
    let failed = 0;

    for (const [customerId, count] of counts) {
      if (!isFrequentPattern(count, threshold)) continue;

      if (await this.repo.hasOpenAggregateAlert(customerId, patternType)) {
        skippedExisting += 1;
        continue;
      }

      try {
        const row = await this.repo.create({
          customerId,
          patternType,
          detailText: detailFor(count),
        });
        created += 1;
        await this.safeAudit({
          userId: actorUserId,
          action: 'CREATE',
          entityType: 'TransactionMonitoringAlert',
          entityId: row.id,
          afterValue: transactionMonitoringAlertAuditSnapshot({
            alertId: row.id,
            customerId: row.customerId,
            patternType: row.patternType,
            status: row.status,
          }),
          isSensitiveDataAccess: true,
        });
      } catch (err) {
        if (isUniqueConstraintViolation(err)) {
          skippedExisting += 1; // a concurrent sweep already opened one
          continue;
        }
        failed += 1;
        this.logger.error(
          `Transaction-monitoring sweep: ${patternType} for customer ${customerId} failed (${(err as Error).message}) — continuing.`,
        );
      }
    }

    return { created, skippedExisting, failed };
  }

  // --- 3. suspicious-activity escalation path ---------------------------

  /** Internal decision that this alert is (or may be) suspicious activity —
   * the first of the two-step escalation path. Idempotent: already-escalated
   * returns the current view rather than erroring, so a retried call is
   * safe. */
  async escalate(
    id: string,
    actorUserId: string,
  ): Promise<TransactionMonitoringAlertView> {
    const existing = await this.mustFind(id);
    // Checked before the status guard: an alert escalated and then closed
    // (close() never checks the escalation flag) must still report itself
    // idempotently on a retried escalate() — the same idempotency contract
    // every other already-done case in this file honours — rather than 422
    // just because it is no longer open.
    if (existing.escalatedToSuspiciousActivity) {
      return deriveTransactionMonitoringAlertView(existing); // idempotent
    }
    if (existing.status !== 'open') {
      throw new UnprocessableEntityException(
        `Transaction-monitoring alert ${id} is ${existing.status} — it cannot be escalated.`,
      );
    }

    const escalatedAt = new Date();
    const res = await this.repo.recordEscalation(id, escalatedAt);
    if (res.count === 0) {
      const now = await this.mustFind(id);
      return deriveTransactionMonitoringAlertView(now); // escalated concurrently
    }

    const after = await this.mustFind(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'TransactionMonitoringAlert',
      entityId: after.id,
      afterValue: transactionMonitoringAlertAuditSnapshot({
        alertId: after.id,
        customerId: after.customerId,
        patternType: after.patternType,
        status: after.status,
        escalatedToSuspiciousActivity: after.escalatedToSuspiciousActivity,
      }),
      isSensitiveDataAccess: true,
    });
    return deriveTransactionMonitoringAlertView(after);
  }

  /** The second step: the report was actually filed with the competent
   * authority. Precondition: `escalate` must have run first — a report with
   * no internal escalation decision behind it is not this flow's shape.
   * Idempotent on an already-reported alert. */
  async reportToAuthority(
    id: string,
    actorUserId: string,
  ): Promise<TransactionMonitoringAlertView> {
    const existing = await this.mustFind(id);
    if (!existing.escalatedToSuspiciousActivity) {
      throw new UnprocessableEntityException(
        `Transaction-monitoring alert ${id} has not been escalated yet — escalate it before reporting to the authority.`,
      );
    }
    if (existing.reportedToAuthorityAt) {
      return deriveTransactionMonitoringAlertView(existing); // idempotent
    }

    const reportedAt = new Date();
    const res = await this.repo.recordReportToAuthority(id, reportedAt);
    if (res.count === 0) {
      const now = await this.mustFind(id);
      return deriveTransactionMonitoringAlertView(now); // reported concurrently
    }

    const after = await this.mustFind(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'TransactionMonitoringAlert',
      entityId: after.id,
      afterValue: transactionMonitoringAlertAuditSnapshot({
        alertId: after.id,
        customerId: after.customerId,
        patternType: after.patternType,
        status: after.status,
        reportedToAuthorityAt: after.reportedToAuthorityAt,
      }),
      isSensitiveDataAccess: true,
    });
    return deriveTransactionMonitoringAlertView(after);
  }

  // --- 4. close ----------------------------------------------------------

  async close(
    id: string,
    actorUserId: string,
  ): Promise<TransactionMonitoringAlertView> {
    const existing = await this.mustFind(id);
    if (existing.status === 'closed') {
      return deriveTransactionMonitoringAlertView(existing); // idempotent
    }

    const res = await this.repo.recordClosure(id);
    if (res.count === 0) {
      const now = await this.mustFind(id);
      return deriveTransactionMonitoringAlertView(now); // already closed concurrently
    }

    const after = await this.mustFind(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'TransactionMonitoringAlert',
      entityId: after.id,
      afterValue: transactionMonitoringAlertAuditSnapshot({
        alertId: after.id,
        customerId: after.customerId,
        patternType: after.patternType,
        status: after.status,
      }),
      isSensitiveDataAccess: true,
    });
    return deriveTransactionMonitoringAlertView(after);
  }

  // --- reads --------------------------------------------------------------

  /** `TransactionMonitoringAlert` is HIGHLY_CONFIDENTIAL — `detailText` can
   * name a payment counterparty ("AML-sensitive", the model's own comment).
   * The `Claim`/`Crm` 360°-view precedent for a Highly Confidential entity
   * is to record every read (ids/counts only, never `detailText`) and flag
   * it `isSensitiveDataAccess` — unlike the Confidential-tier #33/#34/#41/
   * #44/#45 reads, which are deliberately not audited (a `@code-reviewer`
   * MAJOR on the first pass: this module had followed the Confidential-tier
   * precedent instead of the same-tier `Claim` one). */
  async get(
    id: string,
    actorUserId: string,
  ): Promise<TransactionMonitoringAlertView> {
    const row = await this.mustFind(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'TransactionMonitoringAlert',
      entityId: row.id,
      afterValue: { alertId: row.id, patternType: row.patternType },
      isSensitiveDataAccess: true,
    });
    return deriveTransactionMonitoringAlertView(row);
  }

  async list(
    query: ListTransactionMonitoringAlertsQueryDto,
    actorUserId: string,
  ): Promise<TransactionMonitoringAlertView[]> {
    const rows = await this.repo.findMany(
      {
        customerId: query.customerId,
        patternType: query.patternType,
        status: query.status,
        escalatedToSuspiciousActivity: query.escalatedToSuspiciousActivity,
      },
      TRANSACTION_MONITORING_READ_LIMIT,
    );
    if (rows.length >= TRANSACTION_MONITORING_READ_LIMIT) {
      this.logger.warn(
        `Transaction-monitoring-alert list truncated at ${TRANSACTION_MONITORING_READ_LIMIT} rows — narrow with customerId / patternType / status.`,
      );
    }
    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'TransactionMonitoringAlert',
      entityId: 'list',
      afterValue: { count: rows.length },
      isSensitiveDataAccess: rows.length > 0,
    });
    return rows.map((r) => deriveTransactionMonitoringAlertView(r));
  }

  // --- helpers --------------------------------------------------------------

  private async mustFind(id: string) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(
        `Transaction-monitoring alert ${id} not found.`,
      );
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Transaction-monitoring-alert audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
