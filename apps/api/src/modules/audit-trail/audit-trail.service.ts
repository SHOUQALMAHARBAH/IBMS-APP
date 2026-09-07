import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { AuditTrailRepository } from '../../repositories/audit-trail.repository';
import {
  AUDIT_TRAIL_READ_LIMIT,
  buildDocumentVersionViews,
  deriveAuditLogEntryView,
  type AuditLogEntryView,
  type DocumentHistoryView,
} from './audit-trail.config';
import type { ListAuditTrailQueryDto } from './dto/list-audit-trail-query.dto';
import type { WorkflowHistoryQueryDto } from './dto/workflow-history-query.dto';

/**
 * Process 57's second checkbox — "Time-boxed read-only access for the
 * External Auditor role across all records, documents, and workflow
 * history." All three methods read `AuditLogEntry` (directly or, for
 * `documentHistory`, alongside the `Document` version chain) and are
 * book-wide with no ownership scoping — the `SlaDashboardService` shape.
 * "Time-boxed" is `User.accessValidUntil` + `SessionService`, already
 * built and already tested (Auth e2e's "External Auditor time-boxed access
 * (Part 5.1)" suite); nothing here re-implements it.
 *
 * Every read writes a best-effort `READ` audit row and is unconditionally
 * `isSensitiveDataAccess: true` — the audit log, document history, and
 * workflow history of an arbitrary record can surface Highly Confidential
 * content regardless of which specific entity is being inspected, so this
 * reader does not try to classify sensitivity per entityType the way the
 * SLA dashboard's `hasSensitiveEntityType` does; it treats every read here
 * as sensitive by default.
 */
@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(
    private readonly repo: AuditTrailRepository,
    private readonly audit: AuditService,
  ) {}

  async browseAuditLog(
    query: ListAuditTrailQueryDto,
    actorUserId: string,
  ): Promise<AuditLogEntryView[]> {
    const rows = await this.repo.findAuditLog(
      {
        entityType: query.entityType,
        entityId: query.entityId,
        userId: query.userId,
        action: query.action,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
      AUDIT_TRAIL_READ_LIMIT,
    );
    this.warnIfTruncated(rows.length, 'audit-log');

    await this.recordReadBestEffort(
      'AuditLogEntry',
      'browse',
      {
        filters: {
          entityType: query.entityType ?? null,
          entityId: query.entityId ?? null,
          userId: query.userId ?? null,
          action: query.action ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
        },
        returned: rows.length,
      },
      actorUserId,
    );

    return rows.map(deriveAuditLogEntryView);
  }

  async documentHistory(
    documentId: string,
    actorUserId: string,
  ): Promise<DocumentHistoryView> {
    const chain = await this.repo.findDocumentVersionChain(documentId);
    if (!chain) {
      throw new NotFoundException(`Document ${documentId} not found.`);
    }

    const versions = buildDocumentVersionViews(chain, documentId);
    const auditRows = await this.repo.findDocumentAuditTrail(
      chain.map((v) => v.id),
      AUDIT_TRAIL_READ_LIMIT,
    );
    this.warnIfTruncated(auditRows.length, 'document-history');

    await this.recordReadBestEffort(
      'Document',
      documentId,
      {
        versions: versions.length,
        auditEntries: auditRows.length,
      },
      actorUserId,
    );

    return {
      requestedDocumentId: documentId,
      versions,
      auditTrail: auditRows.map(deriveAuditLogEntryView),
    };
  }

  async workflowHistory(
    query: WorkflowHistoryQueryDto,
    actorUserId: string,
  ): Promise<AuditLogEntryView[]> {
    const rows = await this.repo.findWorkflowHistory(
      query.entityType,
      query.entityId,
      AUDIT_TRAIL_READ_LIMIT,
    );
    this.warnIfTruncated(rows.length, 'workflow-history');

    await this.recordReadBestEffort(
      query.entityType,
      query.entityId,
      {
        view: 'workflow-history',
        transitions: rows.length,
      },
      actorUserId,
    );

    return rows.map(deriveAuditLogEntryView);
  }

  private warnIfTruncated(loaded: number, view: string): void {
    if (loaded >= AUDIT_TRAIL_READ_LIMIT) {
      this.logger.warn(
        `Audit trail ${view}: result set truncated at ${AUDIT_TRAIL_READ_LIMIT} rows — narrow the filters.`,
      );
    }
  }

  private async recordReadBestEffort(
    entityType: string,
    entityId: string,
    afterValue: Prisma.InputJsonObject,
    actorUserId: string,
  ): Promise<void> {
    const input: RecordAuditEntryInput = {
      userId: actorUserId,
      action: 'READ',
      entityType,
      entityId,
      isSensitiveDataAccess: true,
      afterValue,
    };
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Audit trail READ row (${entityType}/${entityId}) did not write: ${(err as Error).message}`,
      );
    }
  }
}
