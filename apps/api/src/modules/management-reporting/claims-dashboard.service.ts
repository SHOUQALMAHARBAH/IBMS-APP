import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import {
  ClaimsDashboardRepository,
  CLAIMS_DASHBOARD_READ_LIMIT,
} from '../../repositories/claims-dashboard.repository';
import {
  ANALYTICS_POLICY_LIMIT,
  LossRatioRepository,
} from '../../repositories/loss-ratio.repository';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import {
  buildClaimsDashboardSummary,
  type ClaimsDashboardSummary,
} from './claims-dashboard.config';
import type { ClaimsDashboardQueryDto } from './dto/claims-dashboard-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

function utcMidnight(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

@Injectable()
export class ClaimsDashboardService {
  private readonly logger = new Logger(ClaimsDashboardService.name);

  constructor(
    private readonly repo: ClaimsDashboardRepository,
    private readonly lossRatioRepo: LossRatioRepository,
    private readonly audit: AuditService,
  ) {}

  async summary(
    query: ClaimsDashboardQueryDto,
    actorUserId: string,
  ): Promise<ClaimsDashboardSummary> {
    const now = new Date();
    const asOfRaw = query.asOf
      ? parseHistoricalInstant(query.asOf, 'asOf')
      : now;
    const asOf = utcMidnight(asOfRaw);
    const createdBefore = new Date(asOf.getTime() + DAY_MS);

    const ownerUserIds = query.branchId
      ? (await this.repo.findUserIdsInBranch(query.branchId)).map((u) => u.id)
      : undefined;
    const filters = {
      ownerUserIds,
      insuranceLine: query.insuranceLine,
      insurerId: query.insurerId,
    };

    const [closedClaimsCount, openClaims, lossRatioPolicies] =
      await Promise.all([
        this.repo.countClosed(filters, createdBefore),
        this.repo.findOpenClaimsForAgeing(filters, createdBefore),
        this.lossRatioRepo.loadPoliciesForAnalytics(filters),
      ]);

    if (openClaims.length >= CLAIMS_DASHBOARD_READ_LIMIT) {
      this.logger.warn(
        `Claims dashboard open-claims read truncated at ${CLAIMS_DASHBOARD_READ_LIMIT} rows — outstanding value / ageing figures are partial; move the aggregation into the query.`,
      );
    }
    if (lossRatioPolicies.length >= ANALYTICS_POLICY_LIMIT) {
      this.logger.warn(
        `Claims dashboard loss-ratio breakdown truncated at ${ANALYTICS_POLICY_LIMIT} policies — the figures are partial; move the aggregation into the query.`,
      );
    }

    const summary = buildClaimsDashboardSummary({
      now,
      asOf,
      closedClaimsCount,
      openClaims,
      lossRatioPolicies,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'ClaimsDashboard',
      entityId: summary.asOf,
      isSensitiveDataAccess: true,
      afterValue: claimsDashboardAuditSnapshot(summary),
    });

    return summary;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Claims dashboard audit (${input.action} ${input.entityId}) failed after the read completed: ${(err as Error).message}`,
      );
    }
  }
}

function claimsDashboardAuditSnapshot(
  summary: ClaimsDashboardSummary,
): Prisma.InputJsonObject {
  return {
    asOf: summary.asOf,
    openClaimsCount: summary.openClaimsCount,
    closedClaimsCount: summary.closedClaimsCount,
    outstandingClaimsValueJod: summary.outstandingClaimsValueJod,
    lossRatioGroups: {
      client: summary.lossRatioByClient.length,
      line: summary.lossRatioByLine.length,
      insurer: summary.lossRatioByInsurer.length,
    },
  };
}
