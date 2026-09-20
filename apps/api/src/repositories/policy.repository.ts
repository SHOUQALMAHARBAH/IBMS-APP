import { Injectable } from '@nestjs/common';
import type {
  DataClassification,
  Document,
  DocumentCategory,
  Policy,
  PolicySchedule,
  PolicyStatus,
  Prisma,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { INSURER_IDENTITY_SELECT } from './insurer-identity';

/**
 * The two ways a policy can still matter to an insurer — SEPARATE named sets, because
 * they are operationally different questions and collapsing them hides the half that
 * should give somebody pause.
 *
 * **In force**: cover is running. It will expire on its own and needs nothing further
 * from the insurer.
 *
 * **In issuance**: the insurer still owes an ACTION — issue the policy, resolve a
 * discrepancy, deliver it. This is the set an administrator deciding whether to stop
 * dealing with a company needs most, because it is the list of things still outstanding
 * FROM them. A policy sitting at `DISCREPANCY` is the clearest case: an open matter with
 * that specific insurer that needs them to act.
 *
 * Together with the two terminal statuses below they partition `PolicyStatus` exactly,
 * which `policy-status-sets.spec.ts` asserts — so a new status cannot be added without
 * somebody deciding which of the three it belongs to.
 *
 * Both were promoted here from `cross-sell-opportunity.repository.ts`, where
 * `IN_FORCE_POLICY_STATUSES` was defined for the gap scan and then acquired a second
 * consumer. A policy-status vocabulary belongs with policies, and putting the two sets
 * side by side is what lets the comment contrast them.
 */
export const IN_FORCE_POLICY_STATUSES: readonly PolicyStatus[] = ['ACTIVE'];

/**
 * Deliberately NOT folded into `IN_FORCE_POLICY_STATUSES`, and this is the point of
 * having two names.
 *
 * The cross-sell gap scan wants the narrow reading — its own comment argues for it: "a
 * `DELIVERED` policy is days from `ACTIVE` and the nightly sweep catches it then". The
 * insurer-deactivation impact count wants this one, because an audit row reading
 * `policiesInForce: 0` while six policies sit mid-issuance is a confident wrong answer,
 * which is worse than no count at all.
 *
 * Quietly widening the shared constant to serve the second caller would have changed the
 * first caller's meaning without anyone deciding to. One meaning per name; two names.
 */
export const OPEN_OBLIGATION_POLICY_STATUSES: readonly PolicyStatus[] = [
  'PLACEMENT_CONFIRMED',
  'ISSUED',
  'CHECKING_IN_PROGRESS',
  'DISCREPANCY',
  'VERIFIED',
  'DELIVERED',
];

/** Over: the cover ended, by its own terms or by cancellation. Neither in force nor
 *  awaiting anything, and therefore in neither set above. */
export const CLOSED_POLICY_STATUSES: readonly PolicyStatus[] = [
  'CANCELLED',
  'EXPIRED',
];

const POLICY_INCLUDE = {
  insurer: { select: INSURER_IDENTITY_SELECT },
  // Identity only — the book-wide list has to say WHICH client each policy
  // belongs to, and `customerId` alone does not. Deliberately two columns and
  // not the Customer row: a policy read must not become a route to a
  // customer's wider file.
  customer: { select: { id: true, legalName: true } },
  schedules: { orderBy: { effectiveFrom: 'desc' } },
  documents: { orderBy: { createdAt: 'desc' } },
  // Process 20 — the one maker/checker quality-control row (or null).
  checking: true,
  // Process 21 — the one delivery record (or null).
  deliveryRecord: true,
} as const;

/** A policy with its insurer identity, its coverage-schedule versions and its
 * electronic-file documents — the shape every policy read returns. */
export type PolicyWithContext = Prisma.PolicyGetPayload<{
  include: typeof POLICY_INCLUDE;
}>;

/**
 * The book-wide policy list is paginated, not capped. It was capped until
 * `common/pagination.ts` existed — the comment here used to say so, and said
 * the reason was that no list endpoint in this codebase took a page param.
 * Five now do, this is one of them, and the old cap silently dropped the
 * oldest tail of a book that outgrew it.
 *
 * Paging is only safe because every filter is applied in the query (see
 * `findManyForActor`), so the window narrows a set the caller is already
 * entitled to see. Ordered newest-first, same as before.
 */

export interface ListPoliciesFilter {
  /** `null` = this caller reaches the whole book. Otherwise, only policies
   * whose Customer is owned by this user id. */
  ownerUserId: string | null;
  status?: PolicyStatus;
  /** Matched against policy number, insurance line and the customer's legal
   * name — the three things someone actually has to hand when looking for a
   * policy. */
  search?: string;
}

function buildPolicyListWhere(
  filter: ListPoliciesFilter,
): Prisma.PolicyWhereInput {
  const where: Prisma.PolicyWhereInput = {};

  if (filter.ownerUserId !== null) {
    where.customer = { ownerUserId: filter.ownerUserId };
  }
  if (filter.status) {
    where.status = filter.status;
  }
  if (filter.search) {
    const contains = { contains: filter.search, mode: 'insensitive' } as const;
    where.OR = [
      { policyNumber: contains },
      { insuranceLine: contains },
      { customer: { legalName: contains } },
    ];
  }

  return where;
}

export interface CreatePolicyInput {
  opportunityId: string;
  customerId: string;
  insurerId: string;
  insuranceLine: string;
  inceptionDate: Date;
  expiryDate: Date | null;
  requestedPremium: Prisma.Decimal;
  currency: string;
  placedByUserId: string;
}

export interface PolicyScheduleInput {
  effectiveFrom: Date;
  limits: Prisma.InputJsonValue;
  sumsInsured: Prisma.InputJsonValue;
  namedPerils: string[];
  extensions: string[];
}

export interface PolicyDocumentInput {
  category: DocumentCategory;
  classification: DataClassification;
  fileName: string;
  storageRef: string;
  uploadedByUserId: string;
}

/**
 * Process 18-19 — Policy Placement & Issuance (backlog Part C #18-19, Domain
 * B). Owns `Policy` plus its two policy-scoped child collections,
 * `PolicySchedule` and the `POLICY`/`INVOICE`/... `Document` rows of the
 * electronic Insurance File (Part 4.2) — one repository per aggregate root,
 * same shape as `CustomerRepository` (which co-locates UBO + customer
 * `Document`).
 *
 * `Policy` IS a `WorkflowTransitionService` entity — its `status` column
 * moves ONLY through the workflow engine
 * (ibms-brain/meta/lex/workflow-state-transitions.md). Nothing here writes
 * `status`: the placement row takes the schema `@default(PLACEMENT_CONFIRMED)`
 * on `create`, and the PLACEMENT_CONFIRMED -> ISSUED move at issuance is
 * driven from `PolicyService` through `WorkflowTransitionService.transition`
 * (with the issued scalars passed as its `data`, so the status flip and the
 * policyNumber/issuedPremium write are one atomic, engine-audited write).
 */
@Injectable()
export class PolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreatePolicyInput): Promise<Policy> {
    return this.prisma.client.policy.create({ data: input });
  }

  findById(id: string): Promise<PolicyWithContext | null> {
    return this.prisma.client.policy.findUnique({
      where: { id },
      include: POLICY_INCLUDE,
    });
  }

  /** Just the id + status — for a bounded status-walk loop
   * (`PolicyCheckingService.driveCheckingOutcome`) that re-reads the live
   * status before every hop and does not need the full include. */
  // REMOVED: `isInsurerActive`.
  //
  // It existed for one commit, while `isActive` was deliberately kept out of
  // `INSURER_IDENTITY_SELECT`. That changed when the comparison matrix needed the
  // flag, so placement now reads it from the quote's own insurer — one definition
  // of "is this insurer still ours", not two that could disagree.

  findStatus(id: string): Promise<{ id: string; status: PolicyStatus } | null> {
    return this.prisma.client.policy.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
  }

  findByOpportunityId(
    opportunityId: string,
  ): Promise<PolicyWithContext | null> {
    return this.prisma.client.policy.findUnique({
      where: { opportunityId },
      include: POLICY_INCLUDE,
    });
  }

  findManyByCustomerId(customerId: string): Promise<PolicyWithContext[]> {
    return this.prisma.client.policy.findMany({
      where: { customerId },
      include: POLICY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The book-wide policy list behind `GET /policies` with no
   * opportunity/customer scope — the Policy Checking Officer's work surface,
   * and the only path to a policy for a role that has no customer in hand.
   *
   * `ownerUserId` is the visibility filter and it is applied HERE, in the
   * SQL `where`, never to the rows afterwards. A caller who reaches the whole
   * book (Placement/Manager/Executive/Policy Checking — see
   * `policy.all-owners.read`) passes `null`; anyone else passes their own
   * id and sees only policies on Customers they own.
   *
   * Filtering before the window rather than after it is the standing rule
   * from the `DpoWorkspaceService` defect: a bounded read that is filtered in
   * memory lets the bound silently decide what the caller cannot see. Every
   * filter below is part of the query, so the window bounds the MATCHING
   * rows, not the rows scanned.
   */
  findManyForActor(
    filter: ListPoliciesFilter,
    window: { take: number; skip: number },
  ): Promise<PolicyWithContext[]> {
    return this.prisma.client.policy.findMany({
      where: buildPolicyListWhere(filter),
      include: POLICY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: window.take,
      skip: window.skip,
    });
  }

  /** Counts on the SAME `where` the page query runs, so the two can never
   *  disagree about what is being counted. */
  countForActor(filter: ListPoliciesFilter): Promise<number> {
    return this.prisma.client.policy.count({
      where: buildPolicyListWhere(filter),
    });
  }

  /**
   * The issuance artefacts a #19 call records once the PLACEMENT_CONFIRMED ->
   * ISSUED transition has committed: the opening `PolicySchedule` and the
   * insurer-issued `Document` rows, in ONE interactive transaction — a
   * deliberate local exception to this codebase's no-`$transaction`
   * convention (see `workflow-transition.service.ts` /
   * `quotation.repository.ts`), so a crash between the two cannot leave an
   * ISSUED policy with a schedule but no documents (or vice versa). A `P2002`
   * on the schedule insert is the partial UNIQUE index
   * `PolicySchedule_one_open_per_policy` firing — a concurrent issuance (or a
   * concurrent crash-recovery re-entry) already opened the schedule; the
   * whole transaction rolls back and the caller maps it to 409.
   */
  createIssuanceArtifacts(
    policyId: string,
    schedule: PolicyScheduleInput,
    documents: PolicyDocumentInput[],
  ): Promise<{ schedule: PolicySchedule; documents: Document[] }> {
    return this.prisma.client.$transaction(async (tx) => {
      const createdSchedule = await tx.policySchedule.create({
        data: {
          policyId,
          effectiveFrom: schedule.effectiveFrom,
          limits: schedule.limits,
          sumsInsured: schedule.sumsInsured,
          namedPerils: schedule.namedPerils,
          extensions: schedule.extensions,
        },
      });
      const createdDocuments =
        documents.length === 0
          ? []
          : await tx.document.createManyAndReturn({
              data: documents.map((d) => ({ ...d, policyId })),
            });
      return { schedule: createdSchedule, documents: createdDocuments };
    });
  }

  /**
   * Process 22 — version the coverage schedule for an APPLIED endorsement.
   * ONE interactive transaction (same local-exception rationale as
   * `createIssuanceArtifacts`), so the prior version is closed and the new
   * one opened atomically — "never overwritten", and the partial UNIQUE
   * `PolicySchedule_one_open_per_policy` never sees two open rows:
   *   1. close the current open schedule (`effectiveTo := effectiveFrom`),
   *      reading its coverage first so a null `targetCoverage` carries it
   *      forward;
   *   2. unless this is a cancellation, open a NEW schedule from
   *      `effectiveFrom`, linked by `sourceEndorsementId` (its own `@unique`
   *      — a re-run rolls back on `P2002`, the caller maps it to 409).
   * Returns the new schedule, or `null` for a cancellation (cover ends — no
   * successor row).
   */
  versionScheduleForEndorsement(input: {
    policyId: string;
    endorsementId: string;
    effectiveFrom: Date;
    isCancellation: boolean;
    targetCoverage: {
      limits: Prisma.InputJsonValue;
      sumsInsured: Prisma.InputJsonValue;
      namedPerils: string[];
      extensions: string[];
    } | null;
  }): Promise<PolicySchedule | null> {
    return this.prisma.client.$transaction(async (tx) => {
      const open = await tx.policySchedule.findFirst({
        where: { policyId: input.policyId, effectiveTo: null },
      });
      if (!open) {
        return null;
      }
      await tx.policySchedule.update({
        where: { id: open.id },
        data: { effectiveTo: input.effectiveFrom },
      });
      if (input.isCancellation) {
        return null;
      }
      const coverage = input.targetCoverage ?? {
        limits: open.limits as Prisma.InputJsonValue,
        sumsInsured: open.sumsInsured as Prisma.InputJsonValue,
        namedPerils: open.namedPerils,
        extensions: open.extensions,
      };
      return tx.policySchedule.create({
        data: {
          policyId: input.policyId,
          effectiveFrom: input.effectiveFrom,
          sourceEndorsementId: input.endorsementId,
          limits: coverage.limits,
          sumsInsured: coverage.sumsInsured,
          namedPerils: coverage.namedPerils,
          extensions: coverage.extensions,
        },
      });
    });
  }

  scheduleForEndorsement(
    endorsementId: string,
  ): Promise<PolicySchedule | null> {
    return this.prisma.client.policySchedule.findUnique({
      where: { sourceEndorsementId: endorsementId },
    });
  }

  /** Attach documents to the policy's electronic file at any lifecycle stage
   * (Part 4.2). One `createManyAndReturn` — atomic on its own, no transaction
   * wrapper needed. */
  attachDocuments(
    policyId: string,
    documents: PolicyDocumentInput[],
  ): Promise<Document[]> {
    return this.prisma.client.document.createManyAndReturn({
      data: documents.map((d) => ({ ...d, policyId })),
    });
  }
}
