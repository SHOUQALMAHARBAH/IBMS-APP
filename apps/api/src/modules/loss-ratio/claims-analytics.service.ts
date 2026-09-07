import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import {
  ANALYTICS_POLICY_LIMIT,
  LossRatioRepository,
} from '../../repositories/loss-ratio.repository';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  buildLossRatioBreakdown,
  type LossRatioBreakdown,
  type LossRatioGroupBy,
} from './loss-ratio.config';

export interface LossRatioBreakdownQuery {
  groupBy: LossRatioGroupBy;
  customerId?: string;
  policyId?: string;
  insuranceLine?: string;
}

/**
 * Process 30 (backlog Part C #30) — Claims Analytics. The aggregate
 * `Claims ÷ Premium` breakdown grouped by customer / policy / line, computed on
 * the fly from the current `Policy` / `Claim` / `Settlement` rows (no stored
 * aggregate table — the per-`RenewalCase` `LossRatio` write is #29's job).
 * `claims-analytics.view` is a cross-book reporting permission, so the query is
 * book-wide (no per-owner scoping); the optional `customerId` / `policyId` /
 * `insuranceLine` filters just narrow the policy set first.
 */
@Injectable()
export class ClaimsAnalyticsService {
  private readonly logger = new Logger(ClaimsAnalyticsService.name);

  constructor(
    private readonly repo: LossRatioRepository,
    private readonly audit: AuditService,
  ) {}

  async lossRatioBreakdown(
    query: LossRatioBreakdownQuery,
    actor: AuthenticatedUser,
  ): Promise<LossRatioBreakdown> {
    const policies = await this.repo.loadPoliciesForAnalytics({
      customerId: query.customerId,
      policyId: query.policyId,
      insuranceLine: query.insuranceLine,
    });

    if (policies.length >= ANALYTICS_POLICY_LIMIT) {
      // The written book outgrew the in-memory cap — the breakdown below is
      // computed over the first ANALYTICS_POLICY_LIMIT policies only. Signal
      // it (same shape as the #27 FOLLOWUP_SWEEP_LIMIT warn); the fix is to
      // push the aggregation into the DB.
      this.logger.warn(
        `Claims-analytics loss-ratio breakdown truncated at ${ANALYTICS_POLICY_LIMIT} policies (groupBy=${query.groupBy}) — the figures are partial; move the aggregation into the query.`,
      );
    }

    const breakdown = buildLossRatioBreakdown({
      groupBy: query.groupBy,
      policies,
    });

    // sensitive-data-handling.md / Part 10.3 — the breakdown aggregates
    // `Claim` rows (HIGHLY_CONFIDENTIAL). Record the READ — counts / filters
    // only, never a figure or a claim reference — and flag it sensitive
    // whenever a claim actually contributed (mirrors CrmService.get360View).
    await this.recordAuditBestEffort({
      userId: actor.id,
      // the narrowest scope wins (policy before customer); the full filter
      // set is in `afterValue.filters` regardless.
      entityId: query.policyId ?? query.customerId ?? 'book-wide',
      isSensitiveDataAccess: breakdown.totals.claimCount > 0,
      afterValue: {
        view: 'loss-ratio-breakdown',
        groupBy: query.groupBy,
        filters: {
          customerId: query.customerId ?? null,
          policyId: query.policyId ?? null,
          insuranceLine: query.insuranceLine ?? null,
        },
        policies: breakdown.totals.policyCount,
        claims: breakdown.totals.claimCount,
        groups: breakdown.rows.length,
      },
    });

    return breakdown;
  }

  private async recordAuditBestEffort(input: {
    userId: string;
    entityId: string;
    isSensitiveDataAccess: boolean;
    afterValue: Prisma.InputJsonObject;
  }): Promise<void> {
    try {
      await this.audit.record({
        userId: input.userId,
        action: 'READ',
        entityType: 'ClaimsAnalytics',
        entityId: input.entityId,
        isSensitiveDataAccess: input.isSensitiveDataAccess,
        afterValue: input.afterValue,
      });
    } catch (err) {
      this.logger.error(
        `Claims-analytics READ audit did not write: ${(err as Error).message}`,
      );
    }
  }
}
