import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { SalesDashboardRepository } from '../../repositories/sales-dashboard.repository';
import { parseCalendarDate } from '../../common/calendar-date.util';
import {
  previousUtcMonthRange,
  type PeriodWindow,
} from '../../common/period.util';
import {
  buildSalesDashboardSummary,
  type SalesDashboardSummary,
} from './sales-dashboard.config';
import type { SalesDashboardQueryDto } from './dto/sales-dashboard-query.dto';

/**
 * Part E — Sales Dashboard. See `sales-dashboard.config.ts`'s header
 * comment for the metric set, the filter-applicability rules, and why this
 * is a separate endpoint from backlog #59's own `GET /sales-performance`.
 */
@Injectable()
export class SalesDashboardService {
  private readonly logger = new Logger(SalesDashboardService.name);

  constructor(
    private readonly repo: SalesDashboardRepository,
    private readonly audit: AuditService,
  ) {}

  /** No period fields -> the previous UTC calendar month. All three ->
   * that explicit window. Any other combination is incoherent — 422. The
   * #60/#61 `resolvePeriodFromDto` shape. */
  resolvePeriod(query: SalesDashboardQueryDto): PeriodWindow {
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
    query: SalesDashboardQueryDto,
    actorUserId: string,
  ): Promise<SalesDashboardSummary> {
    const period = this.resolvePeriod(query);
    const { periodStart, periodEnd } = period;

    const ownerUserIds = query.branchId
      ? (await this.repo.findUserIdsInBranch(query.branchId)).map((u) => u.id)
      : undefined;
    const policyFilters = {
      ownerUserIds,
      insuranceLine: query.insuranceLine,
      insurerId: query.insurerId,
    };

    const [
      newLeadsCount,
      convertedToProspectCount,
      newPremiumSum,
      renewalPremiumSum,
      commissionSum,
      crossSellTotal,
      crossSellConverted,
      upSellTotal,
      upSellConverted,
    ] = await Promise.all([
      this.repo.countNewLeads(ownerUserIds, periodStart, periodEnd),
      this.repo.countConvertedToProspectLeads(
        ownerUserIds,
        periodStart,
        periodEnd,
      ),
      this.repo.sumIssuedPremium(policyFilters, periodStart, periodEnd, false),
      this.repo.sumIssuedPremium(policyFilters, periodStart, periodEnd, true),
      this.repo.sumCommission(policyFilters, periodStart, periodEnd),
      this.repo.countCrossSellOpportunities(
        query.insuranceLine,
        periodStart,
        periodEnd,
      ),
      this.repo.countCrossSellConverted(
        query.insuranceLine,
        periodStart,
        periodEnd,
      ),
      this.repo.countUpSellRecommendations(periodStart, periodEnd),
      this.repo.countUpSellConverted(periodStart, periodEnd),
    ]);

    const summary = buildSalesDashboardSummary({
      now: new Date(),
      period,
      newLeadsCount,
      convertedToProspectCount,
      newPremiumSum,
      renewalPremiumSum,
      commissionSum,
      crossSellTotal,
      crossSellConverted,
      upSellTotal,
      upSellConverted,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'SalesDashboard',
      entityId: period.periodLabel,
      afterValue: salesDashboardAuditSnapshot(summary),
    });

    return summary;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Sales dashboard audit (${input.action} ${input.entityId}) failed after the read completed: ${(err as Error).message}`,
      );
    }
  }
}

function salesDashboardAuditSnapshot(
  summary: SalesDashboardSummary,
): Prisma.InputJsonObject {
  return {
    periodLabel: summary.periodLabel,
    newLeadsCount: summary.leads.newLeadsCount,
    premiumWrittenTotalJod: summary.premiumWritten.totalJod,
    commissionIncomeJod: summary.commissionIncomeJod,
  };
}
