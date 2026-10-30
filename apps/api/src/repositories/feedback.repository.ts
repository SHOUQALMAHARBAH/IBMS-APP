import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

const WITH_CUSTOMER = {
  /*
   * RULE 2 — WHICH CUSTOMER, BY NAME. This screen rendered the first eight characters of a uuid,
   * which identifies nobody: the column exists to say who the row is about.
   */
  include: { customer: { select: { legalName: true } } },
} as const;

/**
 * The read shape, DERIVED from the include rather than written out — so the include and the type
 * cannot disagree, and a field added to one reaches the other.
 */
export type FeedbackWithCustomer = Prisma.CustomerFeedbackGetPayload<
  typeof WITH_CUSTOMER
>;

export interface CreateFeedbackInput {
  customerId: string;
  context: string;
  score: number | null;
  comments: string | null;
  submittedAt: Date | undefined;
}

export interface FeedbackScope {
  customerId?: string;
  context?: string;
}

/**
 * Process 45 — Customer Feedback (backlog Part C #45, Domain E). Owns
 * `CustomerFeedback` reads/writes, wrapping `PrismaService` (services depend
 * on repositories in this codebase, never on Prisma directly).
 */
@Injectable()
export class FeedbackRepository {
  constructor(private readonly prisma: PrismaService) {}

  customerExists(customerId: string): Promise<boolean> {
    return this.prisma.client.customer
      .count({ where: { id: customerId } })
      .then((n) => n > 0);
  }

  create(input: CreateFeedbackInput): Promise<FeedbackWithCustomer> {
    return this.prisma.client.customerFeedback.create({
      ...WITH_CUSTOMER,
      data: {
        customerId: input.customerId,
        context: input.context,
        score: input.score,
        comments: input.comments,
        ...(input.submittedAt ? { submittedAt: input.submittedAt } : {}),
      },
    });
  }

  findById(id: string): Promise<FeedbackWithCustomer | null> {
    return this.prisma.client.customerFeedback.findUnique({
      where: { id },
      ...WITH_CUSTOMER,
    });
  }

  findMany(
    scope: FeedbackScope,
    take: number,
  ): Promise<FeedbackWithCustomer[]> {
    return this.prisma.client.customerFeedback.findMany({
      ...WITH_CUSTOMER,
      where: {
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
        ...(scope.context ? { context: scope.context } : {}),
      },
      orderBy: { submittedAt: 'desc' },
      take,
    });
  }
}
