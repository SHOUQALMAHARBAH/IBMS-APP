import { Injectable } from '@nestjs/common';
import type { SlaTimer } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { SLA_DASHBOARD_TIMER_LIMIT } from '../modules/sla-dashboard/sla-dashboard.config';

export interface LoadSlaTimersFilter {
  /** exact `SlaTimer.entityType`. */
  entityType?: string;
  /** `startsWith` on `SlaTimer.workflowName` — a base name (`complaint_resolution`)
   * still matches its `::stage`-suffixed rows. */
  workflowNamePrefix?: string;
  /** default {@link SLA_DASHBOARD_TIMER_LIMIT}. */
  limit?: number;
}

/**
 * Process 43 — SLA Management. The one read the cross-module dashboard needs:
 * `SlaTimer` rows, book-wide (`sla-dashboard.view` is a cross-book monitoring
 * permission — no per-owner scoping), capped. Wraps `PrismaService` (services
 * depend on repositories here, never on Prisma directly). Ordered by `dueAt`
 * so a truncated read keeps the most urgent rows.
 */
@Injectable()
export class SlaDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadTimers(filter: LoadSlaTimersFilter = {}): Promise<SlaTimer[]> {
    return this.prisma.client.slaTimer.findMany({
      where: {
        ...(filter.entityType ? { entityType: filter.entityType } : {}),
        ...(filter.workflowNamePrefix
          ? { workflowName: { startsWith: filter.workflowNamePrefix } }
          : {}),
      },
      // The policy is what lets a row say whether the deadline it is about to
      // report as BREACHED is a legal one or an internal target. Derived per
      // TIMER, not per workflow name, so a historical timer keeps the answer
      // that was true when it started even if the policy was edited since.
      include: {
        slaPolicy: {
          select: {
            policyCode: true,
            sourceType: true,
            warningThreshold: true,
          },
        },
      },
      orderBy: { dueAt: 'asc' },
      take: filter.limit ?? SLA_DASHBOARD_TIMER_LIMIT,
    });
  }
}
