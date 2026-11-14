import { Injectable } from '@nestjs/common';
import type {
  Article15DExemption,
  Article15DExemptionBasis,
  Article15DPremiumAlert,
  CommunicationLog,
  InteractionChannel,
  RfqArticle15DExemption,
} from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

import { PrismaService } from '../prisma/prisma.service';

/**
 * ART. 15/d's TWO TABLES.
 *
 * Both are tenant-scoped with RLS **ENABLED and FORCED**, so every read here is already the
 * caller's own office — `tenantScopeExtension` supplies `organizationId` and the policy refuses
 * anything else. Nothing in this file names an office, deliberately: a repository that could
 * would be a repository somebody could pass the wrong one to.
 */
@Injectable()
export class Article15DRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ONE exemption per request, and `@unique` on `rfqId` is what makes that true rather than
   * conventional. A second attempt is a unique violation and reaches the caller as a 409 — which
   * is the right answer: an RFQ resting on two different exemptions is not a record anybody can
   * read.
   */
  createExemption(input: {
    rfqId: string;
    exemption: Article15DExemption;
    basis: Article15DExemptionBasis;
    insurerCount: number;
    declaredAnnualPremiumJod: Decimal | null;
    ceilingValueJod: Decimal | null;
    evidenceCommunicationLogId: string | null;
    chosenByUserId: string | null;
    chosenByNameShown: string | null;
  }): Promise<RfqArticle15DExemption> {
    return this.prisma.client.rfqArticle15DExemption.create({ data: input });
  }

  findExemptionForRfq(rfqId: string): Promise<RfqArticle15DExemption | null> {
    return this.prisma.client.rfqArticle15DExemption.findUnique({
      where: { rfqId },
    });
  }

  /**
   * The alert. `skipDuplicates`-style idempotence is NOT used: the unique index is
   * `(exemptionId, quotationId)`, so a REVISION of the same quotation that is still above the
   * ceiling must not raise a second alert for the same pair, while a DIFFERENT quotation that
   * also exceeds it raises its own. `upsert` expresses exactly that.
   */
  async raiseAlert(input: {
    exemptionId: string;
    quotationId: string;
    quotedPremiumJod: Decimal;
    ceilingValueJod: Decimal;
  }): Promise<Article15DPremiumAlert> {
    return this.prisma.client.article15DPremiumAlert.upsert({
      where: {
        exemptionId_quotationId: {
          exemptionId: input.exemptionId,
          quotationId: input.quotationId,
        },
      },
      // ⛔ The existing row is NOT updated to the new premium. The alert records what came back
      // when it was raised; rewriting it would lose the figure that triggered it.
      update: {},
      create: input,
    });
  }

  findAlertsForRfq(rfqId: string): Promise<Article15DPremiumAlert[]> {
    return this.prisma.client.article15DPremiumAlert.findMany({
      where: { exemption: { rfqId } },
      orderBy: { raisedAt: 'asc' },
    });
  }

  /** Exemption 5's evidence. Tenant-scoped, so a log from another office is simply not found. */
  findCommunicationLog(id: string): Promise<CommunicationLog | null> {
    return this.prisma.client.communicationLog.findUnique({ where: { id } });
  }

  /**
   * EXEMPTION 5's PICKER — this customer's INBOUND communications on an approved means.
   *
   * ⛔ `select` NAMES THREE COLUMNS AND IS NOT A CONVENIENCE. The text of a communication is
   * Confidential under `sensitive-data-handling.md` — loss history and sums insured live in
   * `body` — and this list is read by whoever holds `rfq.create`, which is not the permission
   * that reads correspondence. The employee identifies the message by WHEN it came and HOW.
   *
   * Capped at 50, newest first: a picker is not a register, and an unbounded read of one
   * customer's whole correspondence to fill a dropdown is the shape this repository has been
   * bitten by before.
   */
  findApprovedInboundForCustomer(
    customerId: string,
    channels: readonly InteractionChannel[],
  ): Promise<{ id: string; channel: InteractionChannel; sentAt: Date }[]> {
    return this.prisma.client.communicationLog.findMany({
      where: {
        customerId,
        direction: 'INBOUND',
        channel: { in: [...channels] },
      },
      select: { id: true, channel: true, sentAt: true },
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
  }
}
