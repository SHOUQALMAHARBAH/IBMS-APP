import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { AuditTrailRepository } from '../../repositories/audit-trail.repository';
import { UserRepository } from '../../repositories/user.repository';
import { pageWindow, type Paginated } from '../../common/pagination';
import {
  AUDIT_TRAIL_READ_LIMIT,
  buildDocumentVersionViews,
  deriveAuditLogEntryView,
  type AuditLogEntryView,
  type DocumentHistoryView,
} from './audit-trail.config';
import type { AuditActorView } from './audit-trail.config';
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
/**
 * A bound on the actor search, not a page.
 *
 * The control is a picker: a reader types a name and chooses. Returning more rows than a person will
 * ever scan would make the response large for no gain, and an unbounded read of a table that grows
 * forever is the shape this codebase caps everywhere else.
 */
export const ACTOR_SEARCH_LIMIT = 50;

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(
    private readonly repo: AuditTrailRepository,
    private readonly audit: AuditService,
    /** Resolving actor ids to names, and backing the actor search below. */
    private readonly users: UserRepository,
  ) {}

  /**
   * THE PEOPLE WHO APPEAR IN THIS OFFICE'S AUDIT LOG, BY NAME.
   *
   * The screen could filter by `entityType` and `entityId` and nothing else, so "what did this person
   * do" — the question an audit trail is read for — had no control, even though the API has accepted a
   * `userId` filter all along. Nobody knows a uuid, so that filter was unusable.
   *
   * Its own endpoint rather than `GET /admin/users`, and that is a measurement not a preference:
   * `audit-log.read` is held by COMPLIANCE, EXTERNAL_AUDITOR, SYSTEM_SECURITY_ADMINISTRATOR and
   * OFFICE_ADMINISTRATOR, while `user.manage` is held by only the last two. Sourcing this from the
   * admin user list would have 403'd for the compliance officer and the external auditor — the audit
   * trail's primary readers — which is the same defect as a form whose owner cannot use it.
   *
   * Only users who ACTUALLY APPEAR as an actor are returned. That leaks nothing the log does not
   * already show this caller (their id is in rows they can read, and the names are now on those rows),
   * and it keeps a read-only external auditor from enumerating the whole staff directory through a
   * filter control.
   *
   * No audit row is written for this search, deliberately: a lookup that writes to the log pollutes the
   * thing being searched, and a reader typing four characters would create four rows of noise in the
   * record they are trying to read. The browse itself is still recorded, which is the reviewable event.
   */
  listActors(search: string | undefined): Promise<AuditActorView[]> {
    return this.repo.findActors(search, ACTOR_SEARCH_LIMIT);
  }

  async browseAuditLog(
    query: ListAuditTrailQueryDto,
    actorUserId: string,
  ): Promise<Paginated<AuditLogEntryView>> {
    const filter = {
      entityType: query.entityType,
      entityId: query.entityId,
      userId: query.userId,
      action: query.action,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    };
    // Paged, not capped. This is the fastest-growing table in the system, and
    // a cap answered a browse of an aged log by silently dropping everything
    // past the newest 5,000 rows — the reader could not tell a short result
    // from a truncated one. `warnIfTruncated` is deliberately NOT called here
    // any more: nothing is truncated, and `total` says how much there is.
    // The two history reads below still cap, and still warn.
    const window = pageWindow(query.page, query.pageSize);
    const [rows, total] = await Promise.all([
      this.repo.findAuditLog(filter, window.take, window.skip),
      this.repo.countAuditLog(filter),
    ]);

    // One lookup for the whole page, keyed on the DISTINCT actors in it — never one per row. A page of
    // 50 rows written by one person is one id, and this is the read that turns a column of uuids into a
    // column of names.
    const distinctActors = [...new Set(rows.map((r) => r.userId))];
    const names = new Map(
      (await this.users.findSummariesByIds(distinctActors)).map((u) => [
        u.id,
        u.fullName,
      ]),
    );

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
        // Which page was read, not just how many rows came back: "browsed the
        // audit log" is a reviewable event, and the page is part of what was
        // actually seen.
        page: window.page,
        pageSize: window.pageSize,
        matching: total,
      },
      actorUserId,
    );

    return {
      items: rows.map((row) => deriveAuditLogEntryView(row, names)),
      total,
      page: window.page,
      pageSize: window.pageSize,
    };
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
      auditTrail: auditRows.map((row) => deriveAuditLogEntryView(row)),
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

    return rows.map((row) => deriveAuditLogEntryView(row));
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
