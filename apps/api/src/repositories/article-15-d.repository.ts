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
/**
 * ONE exemption, with the attached message named by its date and its means and by nothing else.
 *
 * 🔴 OWNER DECISION 159 RULING 4. The relation is the CommunicationLog the evidence points at,
 * narrowed to the two columns the record prints; `null` covers both «exemptions 1-4, which carry
 * no evidence by CHECK» and «exemption 5 with the mark still on it».
 */
export type Article15DExemptionRow = RfqArticle15DExemption & {
  evidenceCommunicationLog: {
    channel: InteractionChannel;
    sentAt: Date;
  } | null;
};

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

  /**
   * 🔴 OWNER DECISION 139 ruling 4 — ATTACH THE EVIDENCE, ONCE.
   *
   * STATUS-CONDITIONAL ON `evidenceCommunicationLogId: null`, which is what makes this race-safe
   * rather than merely usually-right: two employees attaching different messages at the same
   * moment both pass a read-then-write, and the second would silently replace the first. Here
   * the second matches zero rows and the service turns that into a 409.
   *
   * `race-safe-invariants.md` is the rule, and the database agrees with it independently — the
   * narrowed append-only trigger refuses NOT NULL ⟶ anything, so even a caller that bypassed
   * this method could not overwrite an attached log.
   *
   * ⟶ Returns the COUNT rather than the row: "did I win" is the question, and a returned row
   *   would invite a caller to read it as "the row as I left it" when another request may have
   *   won first.
   */
  attachEvidence(
    rfqId: string,
    evidenceCommunicationLogId: string,
  ): Promise<{ count: number }> {
    return this.prisma.client.rfqArticle15DExemption.updateMany({
      where: { rfqId, evidenceCommunicationLogId: null },
      data: { evidenceCommunicationLogId },
    });
  }

  /**
   * 🔴 OWNER DECISION 159 RULING 4 — AND THE ATTACHED MESSAGE COMES BACK NAMED.
   *
   * The attach used to leave the record silent: the «بلا إثبات» mark disappeared and nothing
   * stood where it had been, so an inspector reading the screen could not tell an exemption whose
   * evidence was on file from one that had never been marked.
   *
   * ⛔ `select` NAMES TWO COLUMNS, for the SAME reason the picker's does: the `body` of a
   * communication is Confidential under `sensitive-data-handling.md` — loss history and sums
   * insured live there — and this read is served to whoever may read the request. The screen
   * identifies the message by WHEN it came and HOW, exactly as the candidate row did before it
   * was chosen, which is also why no new word was needed.
   */
  findExemptionForRfq(rfqId: string): Promise<Article15DExemptionRow | null> {
    return this.prisma.client.rfqArticle15DExemption.findUnique({
      where: { rfqId },
      include: {
        evidenceCommunicationLog: {
          select: { channel: true, sentAt: true },
        },
      },
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
