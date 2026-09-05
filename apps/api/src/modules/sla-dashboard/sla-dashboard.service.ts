import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { SlaDashboardRepository } from '../../repositories/sla-dashboard.repository';
import {
  buildSlaDashboardSummary,
  buildSlaTimerRows,
  hasSensitiveEntityType,
  SLA_DASHBOARD_TIMER_LIMIT,
  type SlaDashboardSummary,
  type SlaTimerRow,
  type SlaTimerStateFilter,
} from './sla-dashboard.config';

export interface SlaDashboardTimersQuery {
  state?: SlaTimerStateFilter;
  entityType?: string;
  workflowName?: string;
}

/**
 * Process 43 (backlog Part C #43, Domain E) — SLA Management. The cross-module
 * monitoring surface over the generic `SlaTimer` engine
 * (`apps/api/src/modules/sla/`):
 *
 *   - `summary(actorUserId)` — `GET /sla-dashboard/summary`. Every `SlaTimer`
 *     row (capped), classified at `now` and aggregated by workflow / entity
 *     type / escalation target, plus book-wide totals and a `breachRate`.
 *   - `timers(query, actorUserId)` — `GET /sla-dashboard/timers`. The
 *     filterable drill-down list, worst-first.
 *
 * `sla-dashboard.view` is a cross-book monitoring permission
 * (`[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT,
 * EXTERNAL_AUDITOR]`), so the reads are book-wide with no per-owner filter. No
 * maker/checker (read-only). Both reads write a **best-effort `READ` audit row**
 * (`entityType: 'SlaDashboard'`, counts + `generatedAt` + the query filters
 * only — never an `entityId` or a name), `isSensitiveDataAccess` when the
 * loaded set contains a timer whose `entityType` names a data subject
 * (`SLA_DASHBOARD_SENSITIVE_ENTITY_TYPES`) — the #30 / #40 precedent.
 */
@Injectable()
export class SlaDashboardService {
  private readonly logger = new Logger(SlaDashboardService.name);

  constructor(
    private readonly repo: SlaDashboardRepository,
    private readonly audit: AuditService,
  ) {}

  async summary(actorUserId: string): Promise<SlaDashboardSummary> {
    const timers = await this.repo.loadTimers();
    this.warnIfTruncated(timers.length, 'summary');

    const now = new Date();
    const summary = buildSlaDashboardSummary(timers, now);

    await this.recordReadBestEffort(actorUserId, 'summary', {
      afterValue: {
        view: 'sla-dashboard-summary',
        generatedAt: summary.generatedAt,
        timers: summary.totals.total,
        openBreached: summary.totals.openBreached,
        workflows: summary.byWorkflow.length,
        entityTypes: summary.byEntityType.length,
      },
      sensitive: hasSensitiveEntityType(timers),
    });

    return summary;
  }

  async timers(
    query: SlaDashboardTimersQuery,
    actorUserId: string,
  ): Promise<SlaTimerRow[]> {
    const timers = await this.repo.loadTimers({
      entityType: query.entityType,
      workflowNamePrefix: query.workflowName,
    });
    this.warnIfTruncated(timers.length, 'timers');

    const now = new Date();
    // no explicit `?state=` → show every still-open timer (worst-first).
    const state: SlaTimerStateFilter = query.state ?? 'open';
    const rows = buildSlaTimerRows({ timers, now, state });

    await this.recordReadBestEffort(actorUserId, 'timers', {
      afterValue: {
        view: 'sla-dashboard-timers',
        generatedAt: now.toISOString(),
        filters: {
          state,
          entityType: query.entityType ?? null,
          workflowName: query.workflowName ?? null,
        },
        loaded: timers.length,
        returned: rows.length,
      },
      sensitive: hasSensitiveEntityType(timers),
    });

    return rows;
  }

  private warnIfTruncated(loaded: number, view: string): void {
    if (loaded >= SLA_DASHBOARD_TIMER_LIMIT) {
      this.logger.warn(
        `SLA dashboard ${view}: SlaTimer set truncated at ${SLA_DASHBOARD_TIMER_LIMIT} rows — the figures are partial; move the aggregation into the query.`,
      );
    }
  }

  private async recordReadBestEffort(
    userId: string,
    entityId: 'summary' | 'timers',
    row: { afterValue: Prisma.InputJsonObject; sensitive: boolean },
  ): Promise<void> {
    try {
      await this.audit.record({
        userId,
        action: 'READ',
        entityType: 'SlaDashboard',
        entityId,
        isSensitiveDataAccess: row.sensitive,
        afterValue: row.afterValue,
      });
    } catch (err) {
      this.logger.error(
        `SLA dashboard READ audit did not write: ${(err as Error).message}`,
      );
    }
  }
}
