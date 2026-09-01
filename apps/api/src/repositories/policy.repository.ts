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

const INSURER_IDENTITY_SELECT = {
  id: true,
  name: true,
  nameAr: true,
} as const;

const POLICY_INCLUDE = {
  insurer: { select: INSURER_IDENTITY_SELECT },
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
