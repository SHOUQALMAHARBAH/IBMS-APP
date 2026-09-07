import { Injectable } from '@nestjs/common';
import type { ClientDecision, ClientDecisionType, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

const CLIENT_DECISION_INCLUDE = {
  opportunity: {
    select: { id: true, customerId: true, status: true },
  },
} as const;

/** A client decision with just enough Opportunity context to resolve
 * visibility and report the routing outcome. */
export type ClientDecisionWithContext = Prisma.ClientDecisionGetPayload<{
  include: typeof CLIENT_DECISION_INCLUDE;
}>;

export interface CreateClientDecisionInput {
  opportunityId: string;
  decision: ClientDecisionType;
  evidenceType: string;
  evidenceRef: string;
  notes: string | null;
  capturedByUserId: string;
}

/**
 * Process 17 — Client Decision Handling (backlog Part C #17, Domain B). Owns
 * `ClientDecision` — one per Opportunity (`opportunityId @unique`), a
 * one-shot factual record (no `status`, no maker/checker). The routing it
 * drives is the parent Opportunity's engine transition, done from the
 * service through `WorkflowTransitionService`, never here.
 */
@Injectable()
export class ClientDecisionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateClientDecisionInput): Promise<ClientDecision> {
    return this.prisma.client.clientDecision.create({ data: input });
  }

  findById(id: string): Promise<ClientDecisionWithContext | null> {
    return this.prisma.client.clientDecision.findUnique({
      where: { id },
      include: CLIENT_DECISION_INCLUDE,
    });
  }

  findByOpportunityId(
    opportunityId: string,
  ): Promise<ClientDecisionWithContext | null> {
    return this.prisma.client.clientDecision.findUnique({
      where: { opportunityId },
      include: CLIENT_DECISION_INCLUDE,
    });
  }

  findManyByCustomerId(
    customerId: string,
  ): Promise<ClientDecisionWithContext[]> {
    return this.prisma.client.clientDecision.findMany({
      where: { opportunity: { customerId } },
      include: CLIENT_DECISION_INCLUDE,
      orderBy: { decidedAt: 'desc' },
    });
  }
}
