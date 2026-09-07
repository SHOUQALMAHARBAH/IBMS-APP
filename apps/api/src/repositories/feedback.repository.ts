import { Injectable } from '@nestjs/common';
import type { CustomerFeedback } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

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

  create(input: CreateFeedbackInput): Promise<CustomerFeedback> {
    return this.prisma.client.customerFeedback.create({
      data: {
        customerId: input.customerId,
        context: input.context,
        score: input.score,
        comments: input.comments,
        ...(input.submittedAt ? { submittedAt: input.submittedAt } : {}),
      },
    });
  }

  findById(id: string): Promise<CustomerFeedback | null> {
    return this.prisma.client.customerFeedback.findUnique({ where: { id } });
  }

  findMany(scope: FeedbackScope, take: number): Promise<CustomerFeedback[]> {
    return this.prisma.client.customerFeedback.findMany({
      where: {
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
        ...(scope.context ? { context: scope.context } : {}),
      },
      orderBy: { submittedAt: 'desc' },
      take,
    });
  }
}
