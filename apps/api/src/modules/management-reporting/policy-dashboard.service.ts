import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { PolicyDashboardRepository } from '../../repositories/policy-dashboard.repository';
import { parseCalendarDate } from '../../common/calendar-date.util';
import {
  previousUtcMonthRange,
  type PeriodWindow,
} from '../../common/period.util';
import {
  buildPolicyDashboardSummary,
  DEFAULT_RENEWAL_WINDOW_DAYS,
  type PolicyDashboardSummary,
} from './policy-dashboard.config';
import type { PolicyDashboardQueryDto } from './dto/policy-dashboard-query.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Part E — Policy Dashboard. See `policy-dashboard.config.ts`'s header
 * comment for the metric set and why two metrics are a live snapshot
 * while two are period-scoped.
 */
@Injectable()
export class PolicyDashboardService {
  private readonly logger = new Logger(PolicyDashboardService.name);

  constructor(
    private readonly repo: PolicyDashboardRepository,
    private readonly audit: AuditService,
  ) {}

  /** No period fields -> the previous UTC calendar month. All three -> that
   * explicit window. Any other combination is incoherent — 422. The
   * #60/#61 `resolvePeriodFromDto` shape. */
  resolvePeriod(query: PolicyDashboardQueryDto): PeriodWindow {
    const provided = [
      query.periodLabel,
      query.periodStart,
      query.periodEnd,
    ].filter((v) => v !== undefined).length;
    if (provided === 0) return previousUtcMonthRange(new Date());
    if (provided !== 3) {
      throw new UnprocessableEntityException(
        'periodLabel, periodStart, and periodEnd must all be supplied together, or all omitted for the previous calendar month',
      );
    }
    const periodStart = parseCalendarDate(query.periodStart!, 'periodStart');
    const periodEnd = parseCalendarDate(query.periodEnd!, 'periodEnd');
    if (periodEnd.getTime() <= periodStart.getTime()) {
      throw new UnprocessableEntityException(
        'periodEnd must be after periodStart',
      );
    }
    return { periodLabel: query.periodLabel!, periodStart, periodEnd };
  }

  async summary(
    query: PolicyDashboardQueryDto,
    actorUserId: string,
  ): Promise<PolicyDashboardSummary> {
    const period = this.resolvePeriod(query);
    const { periodStart, periodEnd } = period;
    const renewalWindowDays =
      query.renewalWindowDays ?? DEFAULT_RENEWAL_WINDOW_DAYS;

    const ownerUserIds = query.branchId
      ? (await this.repo.findUserIdsInBranch(query.branchId)).map((u) => u.id)
      : undefined;
    const filters = {
      ownerUserIds,
      insuranceLine: query.insuranceLine,
      insurerId: query.insurerId,
    };

    const now = new Date();
    const windowEnd = new Date(now.getTime() + renewalWindowDays * MS_PER_DAY);

    const [
      activePoliciesCount,
      expiringPoliciesCount,
      newPoliciesIssuedCount,
      cancelledRows,
    ] = await Promise.all([
      this.repo.countActive(filters),
      this.repo.countExpiringWithinWindow(filters, now, windowEnd),
      this.repo.countNewlyIssued(filters, periodStart, periodEnd),
      this.repo.findCancelledInPeriod(filters, periodStart, periodEnd),
    ]);

    const summary = buildPolicyDashboardSummary({
      now,
      period,
      renewalWindowDays,
      activePoliciesCount,
      expiringPoliciesCount,
      newPoliciesIssuedCount,
      cancelledPolicies: cancelledRows.map((r) => ({
        policyId: r.policyId,
        policyNumber: r.policyNumber,
        insuranceLine: r.insuranceLine,
        reason: r.reason,
        cancelledAt: r.appliedAt.toISOString(),
      })),
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'PolicyDashboard',
      entityId: period.periodLabel,
      afterValue: policyDashboardAuditSnapshot(summary),
    });

    return summary;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Policy dashboard audit (${input.action} ${input.entityId}) failed after the read completed: ${(err as Error).message}`,
      );
    }
  }
}

function policyDashboardAuditSnapshot(
  summary: PolicyDashboardSummary,
): Prisma.InputJsonObject {
  return {
    periodLabel: summary.periodLabel,
    activePoliciesCount: summary.activePoliciesCount,
    expiringPoliciesCount: summary.expiringPoliciesCount,
    newPoliciesIssuedCount: summary.newPoliciesIssuedCount,
    cancelledPoliciesCount: summary.cancelledPolicies.length,
  };
}
