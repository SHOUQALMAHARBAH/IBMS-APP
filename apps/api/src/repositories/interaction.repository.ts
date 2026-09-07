import { Injectable } from '@nestjs/common';
import type { Interaction, InteractionChannel } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import type {
  TimelineClaim,
  TimelineComplaint,
  TimelinePolicy,
} from '../modules/crm/crm.config';

export interface CreateInteractionInput {
  customerId: string;
  channel: InteractionChannel;
  summary: string;
  /** Optional — the row defaults to `now()`. Set when logging a call /
   * meeting after the fact. */
  occurredAt?: Date;
  loggedByUserId: string;
}

/**
 * Process 10 — Relationship Management (CRM) (backlog Part C #10). Owns
 * `Interaction` writes/reads, plus the read-only `Policy` / `Claim` /
 * `Complaint` lookups the 360° customer view aggregates — there is no
 * Policy / Claim / Complaint module or repository yet (Domains B, C, E are
 * not built), the same reason `cross-sell-opportunity.repository.ts` owns
 * its own `Policy` reads.
 *
 * The `select` on each aggregate read is deliberate and narrow. `Claim` is
 * HIGHLY_CONFIDENTIAL (ibms-brain/meta/lex/sensitive-data-handling.md), so
 * the claim projection carries an id, a number, a status and dates only —
 * never `causeOfLoss`, `lossLocation`, `estimatedLoss` or any other loss
 * detail. Money figures are left out of the policy projection for the same
 * reason (they are not needed to render a relationship timeline).
 */
@Injectable()
export class InteractionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateInteractionInput): Promise<Interaction> {
    return this.prisma.client.interaction.create({ data: input });
  }

  findManyByCustomerId(customerId: string): Promise<Interaction[]> {
    return this.prisma.client.interaction.findMany({
      where: { customerId },
      orderBy: { occurredAt: 'desc' },
    });
  }

  findPoliciesForTimeline(customerId: string): Promise<TimelinePolicy[]> {
    return this.prisma.client.policy.findMany({
      where: { customerId },
      select: {
        id: true,
        policyNumber: true,
        insuranceLine: true,
        status: true,
        inceptionDate: true,
        expiryDate: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findClaimsForTimeline(customerId: string): Promise<TimelineClaim[]> {
    return this.prisma.client.claim.findMany({
      where: { customerId },
      // HIGHLY_CONFIDENTIAL — ids / status / dates only, never loss detail,
      // money, or a money-derived flag like `isLargeClaim`
      // (ibms-brain/meta/lex/sensitive-data-handling.md).
      select: {
        id: true,
        claimNumber: true,
        status: true,
        lossDate: true,
        createdAt: true,
      },
      orderBy: { lossDate: 'desc' },
    });
  }

  findComplaintsForTimeline(customerId: string): Promise<TimelineComplaint[]> {
    return this.prisma.client.complaint.findMany({
      where: { customerId },
      select: {
        id: true,
        issue: true,
        category: true,
        status: true,
        createdAt: true,
        closedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
