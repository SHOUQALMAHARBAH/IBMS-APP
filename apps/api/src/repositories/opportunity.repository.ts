import { Injectable } from '@nestjs/common';
import type { Opportunity, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 🔴 OWNER DECISION 150 RULING 1 — THE BOOK-WIDE LIST'S FILTER.
 *
 * Byte-for-byte the shape `ListPoliciesFilter` already has, and that is the point rather than
 * laziness: the ruling is that this screen becomes what `/policies` already is, and the
 * visibility rule it becomes is `/policies`'s own — `<family>.all-owners.read` reaches the whole
 * book, everybody else is pinned to Customers they own, EXPRESSED IN THE QUERY.
 *
 * ⛔ The filter may never be applied after the read. Paginating a list that was narrowed in
 * memory lets the page size decide what the caller cannot see — the recorded `DpoWorkspaceService`
 * defect, which `/policies` and `/claims` both carry a comment about.
 */
export interface ListOpportunitiesFilter {
  /** `null` = this caller reaches the whole book. Otherwise, only opportunities whose Customer is
   *  owned by this user id. */
  ownerUserId: string | null;
  /** Matched against the customer's legal name — the one thing a person looking for an
   *  opportunity actually has to hand, an Opportunity having no number of its own. */
  search?: string;
}

const OPPORTUNITY_LIST_INCLUDE = {
  customer: { select: { id: true, legalName: true } },
} as const;

export type OpportunityWithCustomer = Opportunity & {
  customer: { id: string; legalName: string };
};

/*
 * 🔴 OWNER DECISION 163 RULING 1 — THE DETAIL READ CARRIES THE TWO NAMES ITS TITLE NEEDS.
 *
 * The opportunity screen's title was «فرصة تجارية 78684085» and its programme link was
 * «من برنامج التأمين 7c0b5103» — eight characters of a uuid in both places, on the screen a
 * placement officer opens first. The ruling is the customer's name in the title and the
 * programme's name on the link.
 *
 * ⛔ So the DETAIL read joins what the title needs rather than the screen fetching it. The list
 * read has carried `customer.legalName` since decision 150 ruling 1; this adds the same join to
 * the single-row read, plus ONE hop further for the programme's own name — which lives on the
 * `RiskProfile.siteLabel` that `iprogdHeadingWithSite` already renders, so the two screens name
 * a programme the same way and cannot disagree.
 *
 * ⚠️ AND `legalName`, NOT a bilingual pair. Message 50 measured that widening customer and
 * office names to `legalNameAr` reaches 20 sites the owner has ruled nothing about; the three
 * lists already name their customer from `legalName` and this follows them. An empty cell,
 * reported rather than decided.
 */
const OPPORTUNITY_DETAIL_INCLUDE = {
  customer: { select: { id: true, legalName: true } },
  insuranceProgram: {
    select: { id: true, riskProfile: { select: { siteLabel: true } } },
  },
} as const;

export type OpportunityWithNames = OpportunityWithCustomer & {
  insuranceProgram: { id: string; riskProfile: { siteLabel: string } } | null;
};

function buildOpportunityListWhere(
  filter: ListOpportunitiesFilter,
): Prisma.OpportunityWhereInput {
  const customer: Prisma.CustomerWhereInput = {};
  if (filter.ownerUserId !== null) customer.ownerUserId = filter.ownerUserId;
  if (filter.search) {
    customer.legalName = { contains: filter.search, mode: 'insensitive' };
  }
  return Object.keys(customer).length > 0 ? { customer } : {};
}

export interface CreateOpportunityInput {
  customerId: string;
  insuranceProgramId: string;
  createdByUserId: string;
}

/**
 * Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). The
 * minimal parent-record home an `RFQ` hangs off — an Opportunity is created
 * from a FINALIZED `InsuranceProgram` and, in this backlog item, only ever
 * read or listed afterward (the full lifecycle — client decision,
 * renegotiation, close-lost — is Processes 16-17, not built). Same "one
 * repository per aggregate root" shape as lead/prospect/customer.
 *
 * `status` is NEVER written here — it moves only through
 * WorkflowTransitionService (A.6, ibms-brain/meta/lex/
 * workflow-state-transitions.md). The one status move this backlog item
 * drives (NEEDS_CONFIRMED -> RFQ_ISSUED, when the first RFQ is issued) goes
 * through the engine from `rfq.service.ts`.
 */
@Injectable()
export class OpportunityRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateOpportunityInput): Promise<Opportunity> {
    return this.prisma.client.opportunity.create({ data: input });
  }

  findById(id: string): Promise<Opportunity | null> {
    return this.prisma.client.opportunity.findUnique({ where: { id } });
  }

  /**
   * The single-row read for the DETAIL screen, carrying the two names its title needs
   * (decision 163 ruling 1).
   *
   * ⛔ A SEPARATE METHOD RATHER THAN A WIDER `findById`: that one has ten callers across seven
   * modules — client decision, comparison, cross-sell, policy, quotation and two more — none of
   * which renders a title, and widening it would put two joins on every one of their reads.
   */
  findByIdWithNames(id: string): Promise<OpportunityWithNames | null> {
    return this.prisma.client.opportunity.findUnique({
      where: { id },
      include: OPPORTUNITY_DETAIL_INCLUDE,
    });
  }

  findManyByCustomerId(customerId: string): Promise<OpportunityWithCustomer[]> {
    return this.prisma.client.opportunity.findMany({
      where: { customerId },
      include: OPPORTUNITY_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The book-wide list. Every filter is part of the query, so the window bounds the MATCHING
   *  rows rather than the rows scanned. */
  findManyForActor(
    filter: ListOpportunitiesFilter,
    window: { take: number; skip: number },
  ): Promise<OpportunityWithCustomer[]> {
    return this.prisma.client.opportunity.findMany({
      where: buildOpportunityListWhere(filter),
      include: OPPORTUNITY_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: window.take,
      skip: window.skip,
    });
  }

  countForActor(filter: ListOpportunitiesFilter): Promise<number> {
    return this.prisma.client.opportunity.count({
      where: buildOpportunityListWhere(filter),
    });
  }

  /** Every Opportunity for one Insurance Program, newest first — feeds the
   * "a live Opportunity already exists" pre-check in OpportunityService. The
   * partial UNIQUE index `Opportunity_one_live_per_insurance_program`
   * (migration 20260828120000) is what actually enforces the invariant
   * (ibms-brain/meta/lex/race-safe-invariants.md); this read only keeps the
   * pre-check message descriptive. */
  findManyByInsuranceProgramId(
    insuranceProgramId: string,
  ): Promise<Opportunity[]> {
    return this.prisma.client.opportunity.findMany({
      where: { insuranceProgramId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Backlog Part C #16 — set (or clear, with `null`) the configurable
   * senior-officer approval threshold. Not a `status` write, so it stays
   * here rather than going through the workflow engine. */
  updateTargetPremiumThreshold(
    id: string,
    targetPremiumThreshold: Prisma.Decimal | null,
  ): Promise<Opportunity> {
    return this.prisma.client.opportunity.update({
      where: { id },
      data: { targetPremiumThreshold },
    });
  }
}
