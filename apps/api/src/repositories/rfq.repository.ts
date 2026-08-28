import { Injectable } from '@nestjs/common';
import type { Prisma, RFQ, RFQInsurer } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateRfqInput {
  opportunityId: string;
  insuranceLine: string;
  followUpThresholdDays?: number;
  issuedByUserId: string;
}

/** An insurer submission row with the insurer's identity attached — the
 * shape every RFQ read returns. */
export type RfqInsurerWithInsurer = Prisma.RFQInsurerGetPayload<{
  include: {
    insurer: {
      select: {
        id: true;
        name: true;
        nameAr: true;
        financialStrengthRating: true;
      };
    };
  };
}>;

/** An RFQ with its insurer shortlist (each row carrying the insurer's
 * identity), newest submission first. */
export type RfqWithSubmissions = Prisma.RFQGetPayload<{
  include: { insurerSubmissions: true };
}> & { insurerSubmissions: RfqInsurerWithInsurer[] };

/** One submission plus the parent RFQ and its Opportunity — visibility for a
 * per-insurer status change is resolved against `rfq.opportunity.customerId`. */
export type RfqInsurerWithParents = Prisma.RFQInsurerGetPayload<{
  include: {
    insurer: {
      select: {
        id: true;
        name: true;
        nameAr: true;
        financialStrengthRating: true;
      };
    };
    rfq: { include: { opportunity: true } };
  };
}>;

/** An open submission plus just its parent RFQ — the follow-up sweep needs
 * `rfq.followUpThresholdDays` and `rfq.id` only. */
export type RfqInsurerForFollowUp = Prisma.RFQInsurerGetPayload<{
  include: { rfq: true };
}>;

export interface SelectableInsurer {
  id: string;
  name: string;
  nameAr: string | null;
  financialStrengthRating: string | null;
}

const INSURER_IDENTITY_SELECT = {
  id: true,
  name: true,
  nameAr: true,
  financialStrengthRating: true,
} as const;

/**
 * Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). Owns
 * `RFQ` + its `RFQInsurer` shortlist rows (an `RFQInsurer` only ever exists
 * inside one RFQ and is read/written through here), plus the read-only
 * `Insurer` master-data lookup the shortlist picker needs (no Insurer
 * module exists — narrative Process 31, not built).
 *
 * `RFQInsurer.status` is NEVER written here — it moves only through
 * WorkflowTransitionService (A.6). This repository writes the non-status
 * columns (`respondedAt`, `followUpAlertSentAt`) that a transition / the
 * sweep set alongside.
 */
@Injectable()
export class RfqRepository {
  constructor(private readonly prisma: PrismaService) {}

  createRfq(input: CreateRfqInput): Promise<RFQ> {
    return this.prisma.client.rFQ.create({ data: input });
  }

  findRfqById(id: string): Promise<RfqWithSubmissions | null> {
    return this.prisma.client.rFQ.findUnique({
      where: { id },
      include: {
        insurerSubmissions: {
          include: { insurer: { select: INSURER_IDENTITY_SELECT } },
          orderBy: { sentAt: 'asc' },
        },
      },
    });
  }

  findRfqsByOpportunityId(
    opportunityId: string,
  ): Promise<RfqWithSubmissions[]> {
    return this.prisma.client.rFQ.findMany({
      where: { opportunityId },
      include: {
        insurerSubmissions: {
          include: { insurer: { select: INSURER_IDENTITY_SELECT } },
          orderBy: { sentAt: 'asc' },
        },
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  findRfqsByCustomerId(customerId: string): Promise<RfqWithSubmissions[]> {
    return this.prisma.client.rFQ.findMany({
      where: { opportunity: { customerId } },
      include: {
        insurerSubmissions: {
          include: { insurer: { select: INSURER_IDENTITY_SELECT } },
          orderBy: { sentAt: 'asc' },
        },
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  /** The pre-check behind the `@@unique([opportunityId, insuranceLine])`
   * ("one RFQ per line per Opportunity") — the index is the real
   * enforcement (ibms-brain/meta/lex/race-safe-invariants.md); this read
   * only keeps the 409 message descriptive. */
  findRfqByOpportunityAndLine(
    opportunityId: string,
    insuranceLine: string,
  ): Promise<RFQ | null> {
    return this.prisma.client.rFQ.findUnique({
      where: { opportunityId_insuranceLine: { opportunityId, insuranceLine } },
    });
  }

  /** Inserts one SENT shortlist row. Throws Prisma `P2002` on
   * `@@unique([rfqId, insurerId])` when the insurer is already shortlisted —
   * the caller treats that as "already on the list, skip". Per-row (not
   * `createMany`) so the caller can attribute an audit entry to exactly the
   * insurers it actually added. */
  createInsurerSubmission(
    rfqId: string,
    insurerId: string,
  ): Promise<RFQInsurer> {
    return this.prisma.client.rFQInsurer.create({ data: { rfqId, insurerId } });
  }

  findInsurerSubmissionById(id: string): Promise<RfqInsurerWithParents | null> {
    return this.prisma.client.rFQInsurer.findUnique({
      where: { id },
      include: {
        insurer: { select: INSURER_IDENTITY_SELECT },
        rfq: { include: { opportunity: true } },
      },
    });
  }

  /** The insurer ids already on an RFQ's shortlist, out of a candidate set —
   * lets `addInsurers` keep its audit row honest without trusting the
   * subsequent per-row insert to tell it what was new. */
  async findExistingShortlistInsurerIds(
    rfqId: string,
    insurerIds: readonly string[],
  ): Promise<string[]> {
    const rows = await this.prisma.client.rFQInsurer.findMany({
      where: { rfqId, insurerId: { in: [...insurerIds] } },
      select: { insurerId: true },
    });
    return rows.map((r) => r.insurerId);
  }

  /** Race-safe stamp of the follow-up alert timestamp: conditional on the
   * timestamp still being null, so a concurrent sweep / a re-run cannot
   * double-alert (ibms-brain/meta/lex/race-safe-invariants.md — the sweep's
   * "skip rows already alerted" is re-asserted at the write, not trusted
   * from the earlier read). Returns the affected-row count. */
  async stampFollowUpAlert(id: string, at: Date): Promise<number> {
    const { count } = await this.prisma.client.rFQInsurer.updateMany({
      where: { id, followUpAlertSentAt: null },
      data: { followUpAlertSentAt: at },
    });
    return count;
  }

  /** Every not-yet-alerted submission still awaiting a response — the
   * candidate set the nightly sweep filters by the business-day threshold
   * (rfq.config.ts `isFollowUpDue`). QUOTED / DECLINED are done; a submission
   * already stamped is left alone. Unpaginated, like the cross-sell /
   * up-sell sweeps — fine at Domain B's current (pre-Policy-module) volume;
   * revisit with a cursor / batched scan when real RFQ traffic exists. */
  findOpenSubmissionsForFollowUp(): Promise<RfqInsurerForFollowUp[]> {
    return this.prisma.client.rFQInsurer.findMany({
      where: {
        status: { in: ['SENT', 'VIEWED'] },
        followUpAlertSentAt: null,
      },
      include: { rfq: true },
    });
  }

  /** The insurer master data the shortlist picker offers (backlog Part C
   * #11 — "select an insurer shortlist"). Read-only — there is no Insurer
   * module yet (narrative Process 31). */
  async findSelectableInsurers(): Promise<SelectableInsurer[]> {
    return this.prisma.client.insurer.findMany({
      select: INSURER_IDENTITY_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  /** How many of `insurerIds` actually exist — the createRfq / addInsurers
   * "every shortlisted insurer is real" guard. */
  countInsurersByIds(insurerIds: readonly string[]): Promise<number> {
    return this.prisma.client.insurer.count({
      where: { id: { in: [...insurerIds] } },
    });
  }
}
