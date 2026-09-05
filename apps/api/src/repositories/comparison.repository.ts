import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import type { ComparisonRowPlan } from '../modules/comparison/comparison.config';

const INSURER_IDENTITY_SELECT = {
  id: true,
  name: true,
  nameAr: true,
  financialStrengthRating: true,
} as const;

const COMPARISON_INCLUDE = {
  rfq: { select: { id: true, insuranceLine: true, opportunityId: true } },
  rows: {
    include: {
      quotation: {
        include: { insurer: { select: INSURER_IDENTITY_SELECT } },
      },
    },
    // Neutral, stable order — deliberately NOT by premium, so the matrix
    // never reads as "cheapest first = the pick" (that reasoning is Process
    // 16, Recommendation).
    orderBy: { quotation: { insurerId: 'asc' } },
  },
} as const;

/** A comparison matrix with its RFQ context and every row's linked
 * current-version `Quotation` (carrying all the objective dimensions) plus
 * the insurer's identity. */
export type ComparisonWithRows = Prisma.ComparisonMatrixGetPayload<{
  include: typeof COMPARISON_INCLUDE;
}>;

export interface BuildComparisonInput {
  rfqId: string;
  builtByUserId: string;
  missingInsurerIds: string[];
  rows: ComparisonRowPlan[];
}

export interface BuildComparisonResult {
  matrix: ComparisonWithRows;
  /** True when this call created the matrix, false when it rebuilt an
   * existing one — the service uses it for the `CREATE` vs `UPDATE` audit
   * action. Determined inside the transaction, immediately before the
   * upsert; under an extreme concurrent-first-build race the loser could
   * still label its row `CREATE`, but the matrix data is always correct
   * (`rfqId @unique`). */
  created: boolean;
}

/**
 * Process 14 — Quote Comparison (backlog Part C #14, Domain B). Owns
 * `ComparisonMatrix` (one per RFQ, `rfqId @unique`) + its
 * `ComparisonMatrixRow`s. A build is a full (re)assembly — the rows are
 * replaced wholesale from the current-version quotations, never patched.
 */
@Injectable()
export class ComparisonRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert the matrix on `rfqId @unique`, then replace its rows wholesale —
   * all in ONE interactive transaction (a deliberate local exception to
   * this codebase's no-`$transaction` convention, like
   * `QuotationRepository.reviseChain`): a rebuild must never be observable
   * half-applied, and the delete+create pair would otherwise race a
   * concurrent rebuild into doubled or missing rows. The build is
   * deterministic (same current quotations → same matrix), so
   * last-write-wins on a concurrent rebuild is correct; the
   * `@@unique([comparisonMatrixId, quotationId])` is the structural
   * backstop.
   */
  buildOrRebuild(input: BuildComparisonInput): Promise<BuildComparisonResult> {
    return this.prisma.client.$transaction(async (tx) => {
      // Read existence inside the transaction, right before the upsert, so
      // the CREATE-vs-UPDATE flag is as accurate as it can be without
      // fighting Prisma's interactive-transaction error semantics.
      const before = await tx.comparisonMatrix.findUnique({
        where: { rfqId: input.rfqId },
        select: { id: true },
      });
      const matrix = await tx.comparisonMatrix.upsert({
        where: { rfqId: input.rfqId },
        create: {
          rfqId: input.rfqId,
          builtByUserId: input.builtByUserId,
          missingInsurers: input.missingInsurerIds,
        },
        update: {
          builtAt: new Date(),
          builtByUserId: input.builtByUserId,
          missingInsurers: input.missingInsurerIds,
        },
      });
      await tx.comparisonMatrixRow.deleteMany({
        where: { comparisonMatrixId: matrix.id },
      });
      if (input.rows.length > 0) {
        await tx.comparisonMatrixRow.createMany({
          data: input.rows.map((row) => ({
            comparisonMatrixId: matrix.id,
            quotationId: row.quotationId,
            insurerQualityScore: row.insurerQualityScore,
            serviceScore: row.serviceScore,
          })),
        });
      }
      const withRows = await tx.comparisonMatrix.findUniqueOrThrow({
        where: { id: matrix.id },
        include: COMPARISON_INCLUDE,
      });
      return { matrix: withRows, created: before === null };
    });
  }

  findByRfqId(rfqId: string): Promise<ComparisonWithRows | null> {
    return this.prisma.client.comparisonMatrix.findUnique({
      where: { rfqId },
      include: COMPARISON_INCLUDE,
    });
  }

  findById(id: string): Promise<ComparisonWithRows | null> {
    return this.prisma.client.comparisonMatrix.findUnique({
      where: { id },
      include: COMPARISON_INCLUDE,
    });
  }
}
