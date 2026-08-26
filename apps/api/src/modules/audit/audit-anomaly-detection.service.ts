import { Injectable, Logger } from '@nestjs/common';
import type { AuditLogEntry } from '@ibms/db';
import { AccessAnomalyAlertRepository } from '../../repositories/access-anomaly-alert.repository';

// Operational defaults pending Compliance sign-off — same status as
// CYCLE_SLA_DAYS in access-recertification.scheduler.ts: reasonable starting
// points, not sourced from a specific PRIV-STD/PRIV-SOP figure.
const BULK_EXPORT_THRESHOLD = 20;
const BULK_EXPORT_WINDOW_MINUTES = 60;
const OFF_HOURS_START_HOUR = 19; // 19:00 Asia/Amman
const OFF_HOURS_END_HOUR = 7; // 07:00 Asia/Amman
const REPEATED_ACCESS_THRESHOLD = 5;
const REPEATED_ACCESS_WINDOW_MINUTES = 60;

/** Part 10.3 — scans each AuditLogEntry as it's written for bulk-export,
 * off-hours, and repeated-unjustified-access patterns, writing a queryable
 * AccessAnomalyAlert row on a hit. No live notification channel exists in
 * this codebase yet (same as TransactionMonitoringAlert) — this is the
 * detection half, not the delivery half. */
@Injectable()
export class AuditAnomalyDetectionService {
  private readonly logger = new Logger(AuditAnomalyDetectionService.name);

  constructor(private readonly alerts: AccessAnomalyAlertRepository) {}

  /** Called right after AuditService writes `entry`. Never throws — a
   * detection failure must not block the audit write it's piggybacking on. */
  async evaluate(entry: AuditLogEntry): Promise<void> {
    try {
      if (entry.action === 'EXPORT') {
        await this.checkBulkExport(entry);
      }
      if (entry.isSensitiveDataAccess) {
        await this.checkOffHoursAccess(entry);
        await this.checkRepeatedUnjustifiedAccess(entry);
      }
    } catch (err) {
      this.logger.error(
        `Anomaly detection failed for AuditLogEntry ${entry.id}: ${(err as Error).message}`,
      );
    }
  }

  private async checkBulkExport(entry: AuditLogEntry): Promise<void> {
    const since = new Date(
      entry.occurredAt.getTime() - BULK_EXPORT_WINDOW_MINUTES * 60_000,
    );
    const count = await this.alerts.countRecentByUserAndAction(
      entry.userId,
      'EXPORT',
      since,
    );
    if (count < BULK_EXPORT_THRESHOLD) return;
    await this.alerts.create({
      userId: entry.userId,
      patternType: 'BULK_EXPORT',
      detailText: `${count} EXPORT actions in the trailing ${BULK_EXPORT_WINDOW_MINUTES} minutes (threshold ${BULK_EXPORT_THRESHOLD}).`,
      relatedAuditLogEntryIds: [entry.id],
    });
  }

  private async checkOffHoursAccess(entry: AuditLogEntry): Promise<void> {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Amman',
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(entry.occurredAt),
    );
    const isOffHours =
      hour >= OFF_HOURS_START_HOUR || hour < OFF_HOURS_END_HOUR;
    if (!isOffHours) return;
    await this.alerts.create({
      userId: entry.userId,
      patternType: 'OFF_HOURS_ACCESS',
      detailText: `Sensitive-data access to ${entry.entityType}:${entry.entityId} at ${hour}:00 Asia/Amman, outside the ${OFF_HOURS_START_HOUR}:00–${OFF_HOURS_END_HOUR}:00 business window.`,
      relatedAuditLogEntryIds: [entry.id],
    });
  }

  private async checkRepeatedUnjustifiedAccess(
    entry: AuditLogEntry,
  ): Promise<void> {
    const since = new Date(
      entry.occurredAt.getTime() - REPEATED_ACCESS_WINDOW_MINUTES * 60_000,
    );
    const rows = await this.alerts.findRecentSensitiveReadsByUserAndEntity(
      entry.userId,
      entry.entityType,
      entry.entityId,
      since,
    );
    if (rows.length < REPEATED_ACCESS_THRESHOLD) return;
    await this.alerts.create({
      userId: entry.userId,
      patternType: 'REPEATED_UNJUSTIFIED_ACCESS',
      detailText: `${rows.length} sensitive accesses of ${entry.entityType}:${entry.entityId} in the trailing ${REPEATED_ACCESS_WINDOW_MINUTES} minutes (threshold ${REPEATED_ACCESS_THRESHOLD}).`,
      relatedAuditLogEntryIds: rows.map((r) => r.id),
    });
  }
}
