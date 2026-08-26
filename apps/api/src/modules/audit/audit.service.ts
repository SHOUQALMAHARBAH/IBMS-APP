import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, Prisma } from '@ibms/db';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAnomalyDetectionService } from './audit-anomaly-detection.service';

export interface RecordAuditEntryInput {
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  beforeValue?: Prisma.InputJsonValue;
  afterValue?: Prisma.InputJsonValue;
  isSensitiveDataAccess?: boolean;
}

/**
 * Thin, append-only wrapper around AuditLogEntry (Part 10.3 — immutable,
 * polymorphic). Callers must never pass a password, MFA secret, or raw
 * bearer token in beforeValue/afterValue — see sensitive-data-handling.md.
 * No update/delete method exists here on purpose — and since
 * 20260826083942_add_audit_log_entry_immutability_trigger, Postgres itself
 * rejects UPDATE/DELETE against this table regardless of caller.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anomalyDetection: AuditAnomalyDetectionService,
  ) {}

  async record(input: RecordAuditEntryInput): Promise<void> {
    const entry = await this.prisma.client.auditLogEntry.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeValue: input.beforeValue,
        afterValue: input.afterValue,
        isSensitiveDataAccess: input.isSensitiveDataAccess ?? false,
      },
    });
    await this.anomalyDetection.evaluate(entry);
  }

  /** Part 6.2 (M06) — reads the RetentionScheduleItem row for AuditLogEntry
   * (seeded by packages/db/prisma/seed-data/retention-schedule.ts) and
   * returns the cutoff date before which entries are retention-eligible.
   * Returns null if the schedule hasn't been seeded (e.g. a DB that
   * predates this method) rather than assuming a number — see that seed
   * file's header for why the seeded figure is a draft, not a confirmed
   * legal one. Does not delete anything itself: AuditLogEntry is immutable
   * (see the trigger above), so disposal is a separate, dual-control M06
   * workflow this method only informs.
   */
  async getRetentionCutoffDate(): Promise<Date | null> {
    const schedule = await this.prisma.client.retentionScheduleItem.findFirst({
      where: { recordCategory: 'AuditLogEntry' },
    });
    if (!schedule) {
      this.logger.warn(
        'No RetentionScheduleItem found for recordCategory "AuditLogEntry" — has the seed (npm run db:seed) been run?',
      );
      return null;
    }
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - schedule.retentionPeriodMonths);
    return cutoff;
  }
}
