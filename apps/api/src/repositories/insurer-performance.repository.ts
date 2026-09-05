import { Injectable } from '@nestjs/common';
import type { InsurerPerformanceScore, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface RespondedRfqInsurer {
  sentAt: Date;
  respondedAt: Date;
}

export interface QuotationForPricing {
  id: string;
  rfqId: string;
  premium: string; // Prisma.Decimal serializes to string; parsed via toMoney at the call site
}

export interface InsurerPerformanceScoreInput {
  quoteResponseScore: Prisma.Decimal;
  claimsServiceScore: Prisma.Decimal;
  priceScore: Prisma.Decimal;
  serviceQualityScore: Prisma.Decimal;
}

export interface InsurerPerformanceScoreFilter {
  insurerId?: string;
  periodLabel?: string;
}

/**
 * Process 60 — owns `InsurerPerformanceScore` plus every raw query
 * `InsurerPerformanceService.computeScoreForInsurer` needs to derive the
 * four dimensions live, for one insurer, over one `[periodStart, periodEnd)`
 * window. No dependency on any other domain's service — the
 * `KpiDashboardRepository`/`SalesPerformanceRepository` shape.
 */
@Injectable()
export class InsurerPerformanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  listInsurerIds(): Promise<{ id: string }[]> {
    return this.prisma.client.insurer.findMany({ select: { id: true } });
  }

  /** The latest-effective SLA target for one insurer/slaType, or `null` if
   * none has ever been agreed — `InsurerSlaAgreement` is dormant elsewhere
   * in this codebase (`Claim.followUpAlertThresholdDays` derives from a
   * per-line default, never this table); this is its first real consumer. */
  async findSlaTargetDays(
    insurerId: string,
    slaType: string,
  ): Promise<number | null> {
    const row = await this.prisma.client.insurerSlaAgreement.findFirst({
      where: { insurerId, slaType },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row?.targetDays ?? null;
  }

  /** RFQInsurer rows sent in the window with a real response (`respondedAt`
   * set — QUOTED or DECLINED; `NO_RESPONSE` always leaves it null, per
   * `rfq.service.ts`'s own `transitionInsurer`). */
  findRespondedRfqInsurers(
    insurerId: string,
    from: Date,
    to: Date,
  ): Promise<RespondedRfqInsurer[]> {
    return this.prisma.client.rFQInsurer.findMany({
      where: {
        insurerId,
        sentAt: { gte: from, lt: to },
        respondedAt: { not: null },
      },
      select: { sentAt: true, respondedAt: true },
    }) as Promise<RespondedRfqInsurer[]>;
  }

  /** Distinct claims for this insurer (via `Claim.policy.insurerId`)
   * notified in the window. */
  countClaims(insurerId: string, from: Date, to: Date): Promise<number> {
    return this.prisma.client.claim.count({
      where: {
        createdAt: { gte: from, lt: to },
        policy: { insurerId },
      },
    });
  }

  /** Of those, the ones with NO `ClaimFollowUpAlert` ever raised — a claim
   * the insurer never went non-responsive on. */
  countClaimsWithNoFollowUpAlert(
    insurerId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.client.claim.count({
      where: {
        createdAt: { gte: from, lt: to },
        policy: { insurerId },
        followUpAlerts: { none: {} },
      },
    });
  }

  /** This insurer's CURRENT-version quotations received in the window. */
  findCurrentQuotationsInWindow(
    insurerId: string,
    from: Date,
    to: Date,
  ): Promise<QuotationForPricing[]> {
    return this.prisma.client.quotation
      .findMany({
        where: {
          insurerId,
          isCurrentVersion: true,
          receivedAt: { gte: from, lt: to },
        },
        select: { id: true, rfqId: true, premium: true },
      })
      .then((rows) =>
        rows.map((r) => ({ ...r, premium: r.premium.toString() })),
      );
  }

  /** Every OTHER insurer's current-version premium on the same RFQ — the
   * comparison set for a price-competitiveness ratio. */
  findCompetingCurrentPremiums(
    rfqId: string,
    excludeInsurerId: string,
  ): Promise<string[]> {
    return this.prisma.client.quotation
      .findMany({
        where: {
          rfqId,
          isCurrentVersion: true,
          insurerId: { not: excludeInsurerId },
        },
        select: { premium: true },
      })
      .then((rows) => rows.map((r) => r.premium.toString()));
  }

  /** Subjective `serviceScore` values Placement supplied while building a
   * Quote Comparison (Process 14) for this insurer's quotations, scoped by
   * when the matrix was built (`ComparisonMatrix.builtAt`). Sparse by
   * design — the column is optional. */
  async findServiceScores(
    insurerId: string,
    from: Date,
    to: Date,
  ): Promise<string[]> {
    const rows = await this.prisma.client.comparisonMatrixRow.findMany({
      where: {
        serviceScore: { not: null },
        quotation: { insurerId },
        comparisonMatrix: { builtAt: { gte: from, lt: to } },
      },
      select: { serviceScore: true },
    });
    return rows
      .map((r) => r.serviceScore?.toString())
      .filter((v): v is string => v !== undefined);
  }

  /** Insert-or-replace this insurer's score for this period —
   * `@@unique([insurerId, periodLabel])` is the upsert key, so a recompute
   * corrects the same row rather than accumulating a stray duplicate. */
  async upsertScore(
    insurerId: string,
    periodLabel: string,
    scores: InsurerPerformanceScoreInput,
  ): Promise<{ row: InsurerPerformanceScore; wasCreated: boolean }> {
    const existing =
      await this.prisma.client.insurerPerformanceScore.findUnique({
        where: { insurerId_periodLabel: { insurerId, periodLabel } },
      });
    const row = await this.prisma.client.insurerPerformanceScore.upsert({
      where: { insurerId_periodLabel: { insurerId, periodLabel } },
      create: { insurerId, periodLabel, ...scores },
      update: { ...scores, computedAt: new Date() },
    });
    return { row, wasCreated: !existing };
  }

  findMany(
    filter: InsurerPerformanceScoreFilter,
  ): Promise<InsurerPerformanceScore[]> {
    return this.prisma.client.insurerPerformanceScore.findMany({
      where: {
        insurerId: filter.insurerId,
        periodLabel: filter.periodLabel,
      },
      orderBy: { periodLabel: 'desc' },
    });
  }

  findLatest(insurerId: string): Promise<InsurerPerformanceScore | null> {
    return this.prisma.client.insurerPerformanceScore.findFirst({
      where: { insurerId },
      orderBy: { periodLabel: 'desc' },
    });
  }
}
