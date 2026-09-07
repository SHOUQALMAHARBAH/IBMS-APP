import { Injectable } from '@nestjs/common';
import type { AuditAction, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import {
  DOCUMENT_VERSION_CHAIN_WALK_LIMIT,
  type AuditLogEntryRow,
  type DocumentVersionRow,
} from '../modules/audit-trail/audit-trail.config';

export interface AuditLogFilter {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

const AUDIT_LOG_ENTRY_SELECT = {
  id: true,
  userId: true,
  action: true,
  entityType: true,
  entityId: true,
  beforeValue: true,
  afterValue: true,
  isSensitiveDataAccess: true,
  occurredAt: true,
} satisfies Prisma.AuditLogEntrySelect;

const DOCUMENT_VERSION_SELECT = {
  id: true,
  versionNumber: true,
  fileName: true,
  category: true,
  classification: true,
  uploadedByUserId: true,
  deletionLocked: true,
  deletionOverrideByUserId: true,
  createdAt: true,
  previousVersionId: true,
} satisfies Prisma.DocumentSelect;

/**
 * Process 57's second checkbox — the External Auditor's read-only lens
 * over `AuditLogEntry` (logs, workflow history) and `Document` (version
 * history). Read-only, book-wide — no ownership scoping, the
 * `SlaDashboardRepository` shape: compliance/audit monitoring must not be
 * restricted by row-level ownership.
 */
@Injectable()
export class AuditTrailRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAuditLog(
    filter: AuditLogFilter,
    take: number,
  ): Promise<AuditLogEntryRow[]> {
    return this.prisma.client.auditLogEntry.findMany({
      where: {
        ...(filter.entityType ? { entityType: filter.entityType } : {}),
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.userId ? { userId: filter.userId } : {}),
        ...(filter.action ? { action: filter.action as AuditAction } : {}),
        ...(filter.from || filter.to
          ? {
              occurredAt: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lte: filter.to } : {}),
              },
            }
          : {}),
      },
      select: AUDIT_LOG_ENTRY_SELECT,
      orderBy: { occurredAt: 'desc' },
      take,
    });
  }

  findWorkflowHistory(
    entityType: string,
    entityId: string,
    take: number,
  ): Promise<AuditLogEntryRow[]> {
    return this.prisma.client.auditLogEntry.findMany({
      where: { entityType, entityId, action: 'TRANSITION' },
      select: AUDIT_LOG_ENTRY_SELECT,
      orderBy: { occurredAt: 'asc' },
      take,
    });
  }

  findDocumentAuditTrail(
    documentIds: string[],
    take: number,
  ): Promise<AuditLogEntryRow[]> {
    return this.prisma.client.auditLogEntry.findMany({
      where: { entityType: 'Document', entityId: { in: documentIds } },
      select: AUDIT_LOG_ENTRY_SELECT,
      orderBy: { occurredAt: 'asc' },
      take,
    });
  }

  /** Walks the `Document` version chain (`previousVersionId`/`nextVersion`,
   * a doubly-linked list, `previousVersionId @unique`) in BOTH directions
   * from the requested id — most documents are their own whole chain today
   * (no application code creates a second version yet; `versionNumber`
   * stays 1), so this is a forward-compatible walk, not dead code, the #48/
   * #56 dormant-feature precedent. Returns `null` only if the requested id
   * itself does not exist. `DOCUMENT_VERSION_CHAIN_WALK_LIMIT` guards
   * against a data anomaly (a cycle) turning this into an infinite loop —
   * a genuine chain is a handful of revisions. */
  async findDocumentVersionChain(
    documentId: string,
  ): Promise<DocumentVersionRow[] | null> {
    const start = await this.prisma.client.document.findUnique({
      where: { id: documentId },
      select: DOCUMENT_VERSION_SELECT,
    });
    if (!start) return null;

    const byId = new Map<string, DocumentVersionRow>([[start.id, start]]);

    let cursor: DocumentVersionRow = start;
    for (
      let steps = 0;
      cursor.previousVersionId && steps < DOCUMENT_VERSION_CHAIN_WALK_LIMIT;
      steps++
    ) {
      const prev = await this.prisma.client.document.findUnique({
        where: { id: cursor.previousVersionId },
        select: DOCUMENT_VERSION_SELECT,
      });
      if (!prev || byId.has(prev.id)) break;
      byId.set(prev.id, prev);
      cursor = prev;
    }

    cursor = start;
    for (let steps = 0; steps < DOCUMENT_VERSION_CHAIN_WALK_LIMIT; steps++) {
      const next = await this.prisma.client.document.findFirst({
        where: { previousVersionId: cursor.id },
        select: DOCUMENT_VERSION_SELECT,
      });
      if (!next || byId.has(next.id)) break;
      byId.set(next.id, next);
      cursor = next;
    }

    return [...byId.values()];
  }
}
