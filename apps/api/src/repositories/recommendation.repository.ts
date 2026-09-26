import { Injectable } from '@nestjs/common';
import type { Prisma, Recommendation } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import type { RationaleFactors } from '../modules/recommendation/recommendation.config';
import { INSURER_IDENTITY_SELECT } from './insurer-identity';

const RECOMMENDATION_INCLUDE = {
  recommendedQuotation: {
    include: {
      insurer: { select: INSURER_IDENTITY_SELECT },
      // The RFQ's managed-line FK travels with the string, because a Policy INHERITS its line
      // identity from the RFQ it was placed off rather than resolving it again. Selecting only
      // `insuranceLine` here is what left `Policy.insuranceLineId` unpopulated after migration
      // `20261019100000` — the writer had nothing to copy.
      rfq: {
        select: {
          id: true,
          insuranceLine: true,
          insuranceLineId: true,
          officeInsuranceLineId: true,
          opportunityId: true,
        },
      },
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

  /**
   * The LIVE recommendation for an opportunity, or null.
   *
   * `findFirst` with an explicit `discardedAt: null`, not `findUnique` — because since the discard landed,
   * `opportunityId` is no longer unique across the table. It is unique among LIVE rows, enforced by a partial
   * unique index, and that is exactly what this filter selects. Dropping the filter would return whichever
   * row the query plan reached first, which could be a recommendation somebody discarded as raised in error.
   */
  findByOpportunityId(
    opportunityId: string,
  ): Promise<RecommendationWithContext | null> {
    return this.prisma.client.recommendation.findFirst({
      where: { opportunityId, discardedAt: null },
      include: RECOMMENDATION_INCLUDE,
    });
  }

  /**
   * Every recommendation for an opportunity, discarded ones included, newest first.
   *
   * The reason discarded rows are kept rather than deleted: this is the history of what was recommended and
   * withdrawn, with who and why on each row.
   */
  findAllByOpportunityId(
    opportunityId: string,
  ): Promise<RecommendationWithContext[]> {
    return this.prisma.client.recommendation.findMany({
      where: { opportunityId },
      include: RECOMMENDATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
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
    /**
     * Part 4 — the declared combined-duty act, when the checker IS the maker in an office that has declared
     * COMBINED mode. Null on every ordinary two-person act, which is every one until an office declares it.
     * The column is what this pair's CHECK constraint reads: with it null, a self-approval is refused by the
     * database whatever the application decided.
     */
    combinedDutyActId: string | null = null,
  ): Promise<Recommendation | null> {
    const { count } = await this.prisma.client.recommendation.updateMany({
      where: { id, approvedByUserId: null },
      data: {
        approvedByUserId,
        approvedAt: new Date(),
        ...(combinedDutyActId === null ? {} : { combinedDutyActId }),
      },
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
  /**
   * Mark this record discarded — raised in error, never took effect.
   *
   * `updateMany` re-asserting `discardedAt: null` in its own `where`, not `update`: two people discarding
   * the same record at once must not have the second silently overwrite the first one's reason. A count of
   * 0 means somebody else got there, and the service turns that into a 409 naming it
   * (`race-safe-invariants.md`).
   *
   * The three columns are written together because a CHECK constraint refuses them apart — a discard
   * carrying no reason is the one shape nobody can read later.
   */
  async discard(
    id: string,
    input: { discardedByUserId: string; discardedReason: string },
  ): Promise<{ discarded: boolean }> {
    const { count } = await this.prisma.client.recommendation.updateMany({
      where: { id, discardedAt: null },
      data: {
        discardedAt: new Date(),
        discardedByUserId: input.discardedByUserId,
        discardedReason: input.discardedReason.trim(),
      },
    });
    return { discarded: count > 0 };
  }
}
