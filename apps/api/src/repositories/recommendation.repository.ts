import { Injectable } from '@nestjs/common';
import type { Prisma, Recommendation } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import type { RationaleFactors } from '../modules/recommendation/recommendation.config';

const INSURER_IDENTITY_SELECT = {
  id: true,
  name: true,
  nameAr: true,
  financialStrengthRating: true,
} as const;

const RECOMMENDATION_INCLUDE = {
  recommendedQuotation: {
    include: {
      insurer: { select: INSURER_IDENTITY_SELECT },
      rfq: { select: { id: true, insuranceLine: true, opportunityId: true } },
    },
  },
  conflictOfInterestDisclosure: true,
  opportunity: {
    select: {
      id: true,
      customerId: true,
      status: true,
      targetPremiumThreshold: true,
    },
  },
} as const;

/** A recommendation with its recommended `Quotation` (+ insurer + RFQ
 * context), its COI disclosure (or null), and the parent Opportunity's
 * visibility / gate inputs. */
export type RecommendationWithContext = Prisma.RecommendationGetPayload<{
  include: typeof RECOMMENDATION_INCLUDE;
}>;

export interface CreateRecommendationInput {
  opportunityId: string;
  recommendedQuotationId: string;
  draftedByUserId: string;
  rationale: string;
  rationaleFactors: RationaleFactors;
  approvalRequired: boolean;
  conflictOfInterestFlagged: boolean;
  coiCompetingQuotationId: string | null;
  coiCommissionDiffPercent: Prisma.Decimal | null;
}

export interface CreateDisclosureInput {
  recommendationId: string;
  competingQuotationId: string | null;
  commissionDifferencePercent: Prisma.Decimal | null;
  disclosureText: string;
  acknowledgedByUserId: string;
}

/**
 * Process 16 — Broker Recommendation (backlog Part C #16, Domain B). Owns
 * `Recommendation` (one per Opportunity, `opportunityId @unique`) and its
 * `ConflictOfInterestDisclosure` (one per recommendation, `recommendationId
 * @unique`).
 *
 * `Recommendation` has no workflow `status` — the approve / send steps stamp
 * nullable timestamps directly here, each through a **status-conditional
 * `updateMany`** (`... WHERE approvedByUserId IS NULL` / `... WHERE
 * sentToClientAt IS NULL`) so a double-approve / double-send loses the race
 * cleanly (0 rows → the service maps it to 409) rather than a check-then-act
 * (ibms-brain/meta/lex/race-safe-invariants.md). Maker/checker on approve is
 * enforced by `assertDifferentActors` in the service + the
 * `Recommendation_maker_checker_distinct` CHECK constraint.
 */
@Injectable()
export class RecommendationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateRecommendationInput): Promise<Recommendation> {
    return this.prisma.client.recommendation.create({
      data: {
        opportunityId: input.opportunityId,
        recommendedQuotationId: input.recommendedQuotationId,
        draftedByUserId: input.draftedByUserId,
        rationale: input.rationale,
        rationaleFactors: input.rationaleFactors,
        approvalRequired: input.approvalRequired,
        conflictOfInterestFlagged: input.conflictOfInterestFlagged,
        coiCompetingQuotationId: input.coiCompetingQuotationId,
        coiCommissionDiffPercent: input.coiCommissionDiffPercent,
      },
    });
  }

  findById(id: string): Promise<RecommendationWithContext | null> {
    return this.prisma.client.recommendation.findUnique({
      where: { id },
      include: RECOMMENDATION_INCLUDE,
    });
  }

  findByOpportunityId(
    opportunityId: string,
  ): Promise<RecommendationWithContext | null> {
    return this.prisma.client.recommendation.findUnique({
      where: { opportunityId },
      include: RECOMMENDATION_INCLUDE,
    });
  }

  findManyByCustomerId(
    customerId: string,
  ): Promise<RecommendationWithContext[]> {
    return this.prisma.client.recommendation.findMany({
      where: { opportunity: { customerId } },
      include: RECOMMENDATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Stamp `approvedByUserId` / `approvedAt`, conditional on it not already
   * being set. Returns the updated row, or `null` when 0 rows matched (a
   * concurrent approve won). */
  async recordApproval(
    id: string,
    approvedByUserId: string,
  ): Promise<Recommendation | null> {
    const { count } = await this.prisma.client.recommendation.updateMany({
      where: { id, approvedByUserId: null },
      data: { approvedByUserId, approvedAt: new Date() },
    });
    if (count === 0) return null;
    return this.prisma.client.recommendation.findUniqueOrThrow({
      where: { id },
    });
  }

  /** Stamp `sentToClientAt` / `sentByUserId`, conditional on it not already
   * being set. Returns the updated row, or `null` when 0 rows matched. */
  async recordSent(
    id: string,
    sentByUserId: string,
  ): Promise<Recommendation | null> {
    const { count } = await this.prisma.client.recommendation.updateMany({
      where: { id, sentToClientAt: null },
      data: { sentToClientAt: new Date(), sentByUserId },
    });
    if (count === 0) return null;
    return this.prisma.client.recommendation.findUniqueOrThrow({
      where: { id },
    });
  }

  createDisclosure(
    input: CreateDisclosureInput,
  ): Promise<Prisma.ConflictOfInterestDisclosureGetPayload<object>> {
    return this.prisma.client.conflictOfInterestDisclosure.create({
      data: {
        recommendationId: input.recommendationId,
        competingQuotationId: input.competingQuotationId,
        commissionDifferencePercent: input.commissionDifferencePercent,
        disclosureText: input.disclosureText,
        acknowledgedByUserId: input.acknowledgedByUserId,
      },
    });
  }
}
