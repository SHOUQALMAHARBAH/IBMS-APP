import { Injectable } from '@nestjs/common';
import type { Prisma, Quotation } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import type { NormalizedQuotationTerms } from '../modules/quotation/quotation.config';

const INSURER_IDENTITY_SELECT = {
  id: true,
  name: true,
  nameAr: true,
  financialStrengthRating: true,
} as const;

const RFQ_CONTEXT_SELECT = {
  id: true,
  opportunityId: true,
  insuranceLine: true,
} as const;

/** A quotation row with the insurer's identity and its RFQ's context
 * attached — the shape every quotation read returns. */
export type QuotationWithContext = Prisma.QuotationGetPayload<{
  include: {
    insurer: { select: typeof INSURER_IDENTITY_SELECT };
    rfq: { select: typeof RFQ_CONTEXT_SELECT };
  };
}>;

export interface CreateInitialQuotationInput extends NormalizedQuotationTerms {
  rfqId: string;
  insurerId: string;
  capturedByUserId: string;
}

export interface ReviseChainInput extends NormalizedQuotationTerms {
  /** The chain's current version, being superseded. */
  currentId: string;
  rfqId: string;
  insurerId: string;
  versionNumber: number;
  capturedByUserId: string;
}

/**
 * Process 13 — Quotation Management (backlog Part C #13, Domain B). Owns the
 * `Quotation` version chain — one insurer's successive quotes on one RFQ
 * line, linked by `previousVersionId`, with exactly one `isCurrentVersion`
 * row per `(rfqId, insurerId)` (a PARTIAL UNIQUE index, migration
 * 20260901120000, is the real enforcement —
 * ibms-brain/meta/lex/race-safe-invariants.md).
 *
 * `Quotation` has no workflow `status`, so nothing here is a
 * WorkflowTransitionService concern; `isCurrentVersion` is flipped inside
 * `reviseChain` by a status-conditional `updateMany` (the same "guard right
 * at the write" pattern the workflow engine uses), paired with the
 * successor insert in one interactive transaction so the two are atomic.
 */
@Injectable()
export class QuotationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The columns `capture` and `revise` persist identically — only the
   * chain linkage differs. Prisma rejects a bare `null` for a `Json?`
   * column, so `limits` is passed through only when set (an object the DTO
   * already validated; stored opaquely) and otherwise left `undefined` so
   * the column takes its NULL default. */
  private toColumns(
    terms: NormalizedQuotationTerms,
  ): Omit<Prisma.QuotationUncheckedCreateInput, 'rfqId' | 'insurerId'> {
    return {
      premium: terms.premium,
      currency: terms.currency,
      deductible: terms.deductible,
      biPeriodMonths: terms.biPeriodMonths,
      liabilityLimit: terms.liabilityLimit,
      exclusions: terms.exclusions,
      conditions: terms.conditions,
      commissionRatePercent: terms.commissionRatePercent,
      limits:
        terms.limits === null
          ? undefined
          : (terms.limits as Prisma.InputJsonValue),
    };
  }

  createInitial(input: CreateInitialQuotationInput): Promise<Quotation> {
    const { rfqId, insurerId, capturedByUserId, ...terms } = input;
    return this.prisma.client.quotation.create({
      data: {
        rfqId,
        insurerId,
        capturedByUserId,
        versionNumber: 1,
        isCurrentVersion: true,
        ...this.toColumns(terms),
      },
    });
  }

  /**
   * The two writes a renegotiation needs, in ONE interactive transaction —
   * a deliberate, local exception to this codebase's no-`$transaction`
   * convention (see `workflow-transition.service.ts`), because the pair
   * must be atomic:
   *   1. clear the predecessor's `isCurrentVersion`, conditional on it
   *      still being `true` — a concurrent revise that got there first
   *      matches 0 rows, so this returns `null` and the whole transaction
   *      rolls back (the caller maps `null` to a 409);
   *   2. insert the successor AS the current version, linked by
   *      `previousVersionId`. A `P2002` here — the PARTIAL UNIQUE
   *      `(rfqId, insurerId) WHERE isCurrentVersion`, or `previousVersionId`'s
   *      own `@unique` — also rolls the transaction back, so the
   *      predecessor's flag is never left cleared with no successor. No
   *      repair step, and a hard crash between the two steps cannot leave
   *      the chain headless (which would dead-end future `revise()` calls
   *      and let a later `capture()` mint a disconnected second v1).
   */
  reviseChain(input: ReviseChainInput): Promise<Quotation | null> {
    const {
      currentId,
      rfqId,
      insurerId,
      versionNumber,
      capturedByUserId,
      ...terms
    } = input;
    return this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.quotation.updateMany({
        where: { id: currentId, isCurrentVersion: true },
        data: { isCurrentVersion: false },
      });
      if (count === 0) return null;
      return tx.quotation.create({
        data: {
          rfqId,
          insurerId,
          capturedByUserId,
          versionNumber,
          previousVersionId: currentId,
          isCurrentVersion: true,
          ...this.toColumns(terms),
        },
      });
    });
  }

  findById(id: string): Promise<QuotationWithContext | null> {
    return this.prisma.client.quotation.findUnique({
      where: { id },
      include: {
        insurer: { select: INSURER_IDENTITY_SELECT },
        rfq: { select: RFQ_CONTEXT_SELECT },
      },
    });
  }

  /** Every version for one RFQ, grouped-ready: insurer ascending, then
   * `versionNumber` ascending within each chain. */
  findManyByRfqId(rfqId: string): Promise<QuotationWithContext[]> {
    return this.prisma.client.quotation.findMany({
      where: { rfqId },
      include: {
        insurer: { select: INSURER_IDENTITY_SELECT },
        rfq: { select: RFQ_CONTEXT_SELECT },
      },
      orderBy: [{ insurerId: 'asc' }, { versionNumber: 'asc' }],
    });
  }

  findManyByOpportunityId(
    opportunityId: string,
  ): Promise<QuotationWithContext[]> {
    return this.prisma.client.quotation.findMany({
      where: { rfq: { opportunityId } },
      include: {
        insurer: { select: INSURER_IDENTITY_SELECT },
        rfq: { select: RFQ_CONTEXT_SELECT },
      },
      orderBy: [
        { rfqId: 'asc' },
        { insurerId: 'asc' },
        { versionNumber: 'asc' },
      ],
    });
  }

  findManyByCustomerId(customerId: string): Promise<QuotationWithContext[]> {
    return this.prisma.client.quotation.findMany({
      where: { rfq: { opportunity: { customerId } } },
      include: {
        insurer: { select: INSURER_IDENTITY_SELECT },
        rfq: { select: RFQ_CONTEXT_SELECT },
      },
      orderBy: [
        { rfqId: 'asc' },
        { insurerId: 'asc' },
        { versionNumber: 'asc' },
      ],
    });
  }
}
