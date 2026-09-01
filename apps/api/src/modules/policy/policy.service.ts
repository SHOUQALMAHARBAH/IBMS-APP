import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { Policy, PolicyStatus } from '@ibms/db';
import {
  PolicyRepository,
  type PolicyDocumentInput,
  type PolicyWithContext,
} from '../../repositories/policy.repository';
import { OpportunityRepository } from '../../repositories/opportunity.repository';
import { RecommendationRepository } from '../../repositories/recommendation.repository';
import { ClientDecisionRepository } from '../../repositories/client-decision.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { CUSTOMER_FILE_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import {
  compareMoney,
  formatMoney,
  quantizeMoney,
} from '../../common/money.util';
import {
  PLACEMENT_DECISION,
  assertCoverageFigures,
  parseCalendarDate,
  policyDocumentAuditSnapshot,
  policyIssuanceAuditSnapshot,
  policyPlacementAuditSnapshot,
  policyScheduleAuditSnapshot,
  premiumVariance,
} from './policy.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PlacePolicyDto } from './dto/place-policy.dto';
import type { RecordPolicyIssuanceDto } from './dto/record-policy-issuance.dto';
import type { AttachPolicyDocumentsDto } from './dto/attach-policy-documents.dto';
import type { ListPoliciesQueryDto } from './dto/list-policies-query.dto';

interface PolicyScheduleView {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  limits: Prisma.JsonValue;
  sumsInsured: Prisma.JsonValue;
  namedPerils: string[];
  extensions: string[];
  sourceEndorsementId: string | null;
  createdAt: Date;
}

interface PolicyDocumentView {
  id: string;
  category: string;
  classification: string;
  fileName: string;
  storageRef: string;
  versionNumber: number;
  previousVersionId: string | null;
  uploadedByUserId: string;
  createdAt: Date;
}

/** A policy as the API returns it. `premiumVariance` is the signed
 * issued-minus-requested delta (null until issued); `issuanceComplete` is
 * true once the policy has moved past `PLACEMENT_CONFIRMED` and carries at
 * least one coverage schedule. */
export interface PolicyView {
  id: string;
  opportunityId: string;
  customerId: string;
  insurerId: string;
  insurer: { id: string; name: string; nameAr: string | null } | null;
  policyNumber: string | null;
  insuranceLine: string;
  status: PolicyStatus;
  inceptionDate: Date | null;
  expiryDate: Date | null;
  requestedPremium: string;
  issuedPremium: string | null;
  premiumVariance: string | null;
  currency: string;
  placedByUserId: string | null;
  issuedByUserId: string | null;
  schedules: PolicyScheduleView[];
  documents: PolicyDocumentView[];
  issuanceComplete: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const P2002 = 'P2002';
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
  );
}

/**
 * Process 18-19 — Policy Placement & Issuance (backlog Part C #18-19, Domain
 * B).
 *
 *  - `place` — create one `Policy` per Opportunity (`opportunityId @unique`)
 *    from a client-**accepted** recommendation. The authoritative precondition
 *    is a `ClientDecision` of `ACCEPT` (the Opportunity status can lag a #17
 *    best-effort route). Insurer / insurance line / requested premium /
 *    currency come from the accepted recommendation's current-version
 *    `Quotation`, not the request body; the caller sets the inception date.
 *    The row takes the schema `@default(PLACEMENT_CONFIRMED)` — no engine
 *    transition (initial creation, same as an Opportunity created at
 *    `NEEDS_CONFIRMED`).
 *  - `recordIssuance` — record the insurer-issued policy: its number, the
 *    issued premium (from the premium invoice), an optional period
 *    correction, the opening `PolicySchedule`, and the issued `Document`
 *    rows. Moves the Policy `PLACEMENT_CONFIRMED -> ISSUED` through
 *    `WorkflowTransitionService.transition`, passing the issued scalars as
 *    its `data` so the status flip and the policyNumber / issuedPremium write
 *    are one atomic, engine-audited write. The schedule + documents are then
 *    created in one `$transaction`. A crash-recovery re-entry branch
 *    completes a partially-done issuance (status already `ISSUED`, no open
 *    schedule) without re-transitioning.
 *  - `attachDocuments` — add documents to the policy's electronic Insurance
 *    File (Part 4.2) at any lifecycle stage.
 *  - `list` / `get` — read, scoped to exactly one of `opportunityId` /
 *    `customerId`.
 *
 * `Policy` IS a `WorkflowTransitionService` entity — its `status` moves only
 * through the engine. It is NOT maker/checker at this stage (placing and
 * recording issuance is single-actor Placement work; the mandatory
 * independent check is Process 20, `PolicyChecking`). Visibility mirrors
 * `RecommendationService`: a policy inherits its Customer's visibility.
 */
@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);

  constructor(
    private readonly policies: PolicyRepository,
    private readonly opportunities: OpportunityRepository,
    private readonly recommendations: RecommendationRepository,
    private readonly clientDecisions: ClientDecisionRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
  ) {}

  private canReachAnyCustomer(actor: AuthenticatedUser): boolean {
    return actor.roles.some((role) =>
      (CUSTOMER_FILE_CROSS_OWNER_ROLES as readonly string[]).includes(role),
    );
  }

  /** Logged, not thrown — the real write already committed. */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Policy audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  private async assertCustomerVisible(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const customer = await this.customers.findById(customerId);
    if (
      !customer ||
      (!this.canReachAnyCustomer(actor) && customer.ownerUserId !== actor.id)
    ) {
      throw new NotFoundException('Customer not found');
    }
  }

  /** Loads an Opportunity and enforces the caller's visibility on its
   * Customer; every failure mode collapses to one NotFoundException (no
   * existence oracle). */
  private async loadVisibleOpportunity(
    opportunityId: string,
    actor: AuthenticatedUser,
  ): Promise<{ id: string; customerId: string }> {
    const opportunity = await this.opportunities.findById(opportunityId);
    if (!opportunity) {
      throw new NotFoundException('Opportunity not found');
    }
    try {
      await this.assertCustomerVisible(opportunity.customerId, actor);
    } catch {
      throw new NotFoundException('Opportunity not found');
    }
    return { id: opportunity.id, customerId: opportunity.customerId };
  }

  private async loadVisible(
    id: string,
    actor: AuthenticatedUser,
    label = 'Policy not found',
  ): Promise<PolicyWithContext> {
    const policy = await this.policies.findById(id);
    if (!policy) {
      throw new NotFoundException(label);
    }
    try {
      await this.assertCustomerVisible(policy.customerId, actor);
    } catch {
      throw new NotFoundException(label);
    }
    return policy;
  }

  private toView(policy: PolicyWithContext): PolicyView {
    return {
      id: policy.id,
      opportunityId: policy.opportunityId,
      customerId: policy.customerId,
      insurerId: policy.insurerId,
      insurer: policy.insurer,
      policyNumber: policy.policyNumber,
      insuranceLine: policy.insuranceLine,
      status: policy.status,
      inceptionDate: policy.inceptionDate,
      expiryDate: policy.expiryDate,
      requestedPremium: formatMoney(policy.requestedPremium),
      issuedPremium:
        policy.issuedPremium === null
          ? null
          : formatMoney(policy.issuedPremium),
      premiumVariance: premiumVariance(
        policy.requestedPremium,
        policy.issuedPremium,
      ),
      currency: policy.currency,
      placedByUserId: policy.placedByUserId,
      issuedByUserId: policy.issuedByUserId,
      schedules: policy.schedules.map((s) => ({
        id: s.id,
        effectiveFrom: s.effectiveFrom,
        effectiveTo: s.effectiveTo,
        limits: s.limits,
        sumsInsured: s.sumsInsured,
        namedPerils: s.namedPerils,
        extensions: s.extensions,
        sourceEndorsementId: s.sourceEndorsementId,
        createdAt: s.createdAt,
      })),
      documents: policy.documents.map((d) => ({
        id: d.id,
        category: d.category,
        classification: d.classification,
        fileName: d.fileName,
        storageRef: d.storageRef,
        versionNumber: d.versionNumber,
        previousVersionId: d.previousVersionId,
        uploadedByUserId: d.uploadedByUserId,
        createdAt: d.createdAt,
      })),
      issuanceComplete:
        policy.status !== 'PLACEMENT_CONFIRMED' && policy.schedules.length > 0,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }

  async place(
    dto: PlacePolicyDto,
    actor: AuthenticatedUser,
  ): Promise<PolicyView> {
    const opportunity = await this.loadVisibleOpportunity(
      dto.opportunityId,
      actor,
    );

    const decision = await this.clientDecisions.findByOpportunityId(
      dto.opportunityId,
    );
    if (!decision || decision.decision !== PLACEMENT_DECISION) {
      throw new UnprocessableEntityException(
        `Opportunity ${dto.opportunityId} has no ACCEPT client decision — a Policy is created once the client accepts the recommendation.`,
      );
    }

    const recommendation = await this.recommendations.findByOpportunityId(
      dto.opportunityId,
    );
    if (!recommendation || recommendation.sentToClientAt === null) {
      throw new UnprocessableEntityException(
        `Opportunity ${dto.opportunityId} has an ACCEPT decision but no sent recommendation to place.`,
      );
    }
    const quote = recommendation.recommendedQuotation;

    const existing = await this.policies.findByOpportunityId(dto.opportunityId);
    if (existing) {
      throw new ConflictException(
        `Opportunity ${dto.opportunityId} already has a Policy (${existing.id}${
          existing.policyNumber ? `, ${existing.policyNumber}` : ''
        }).`,
      );
    }

    const inceptionDate = parseCalendarDate(dto.inceptionDate, 'inceptionDate');
    const expiryDate = dto.expiryDate
      ? parseCalendarDate(dto.expiryDate, 'expiryDate')
      : null;
    if (expiryDate && expiryDate.getTime() <= inceptionDate.getTime()) {
      throw new UnprocessableEntityException(
        'expiryDate must be after the inception date.',
      );
    }

    let created: Policy;
    try {
      created = await this.policies.create({
        opportunityId: dto.opportunityId,
        customerId: opportunity.customerId,
        insurerId: quote.insurerId,
        insuranceLine: quote.rfq.insuranceLine,
        inceptionDate,
        expiryDate,
        requestedPremium: quantizeMoney(quote.premium),
        currency: quote.currency,
        placedByUserId: actor.id,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Opportunity ${dto.opportunityId} already has a Policy.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Policy',
      entityId: created.id,
      afterValue: policyPlacementAuditSnapshot(created),
    });

    return this.toView(await this.loadVisible(created.id, actor));
  }

  async recordIssuance(
    id: string,
    dto: RecordPolicyIssuanceDto,
    actor: AuthenticatedUser,
  ): Promise<PolicyView> {
    const policy = await this.loadVisible(id, actor);

    const issuedPremium = quantizeMoney(dto.issuedPremium);
    if (issuedPremium.isNegative()) {
      throw new UnprocessableEntityException(
        'issuedPremium cannot be negative.',
      );
    }

    const inceptionOverride = dto.inceptionDate
      ? parseCalendarDate(dto.inceptionDate, 'inceptionDate')
      : null;
    const expiryOverride = dto.expiryDate
      ? parseCalendarDate(dto.expiryDate, 'expiryDate')
      : null;
    // The effective policy period after this call: an override wins, else the
    // value placement already stored. Both ends are checked so an inception
    // override alone can't be pushed past the stored expiry (and vice versa).
    const effectiveInception = inceptionOverride ?? policy.inceptionDate;
    const effectiveExpiry = expiryOverride ?? policy.expiryDate;
    if (
      effectiveExpiry &&
      effectiveInception &&
      effectiveExpiry.getTime() <= effectiveInception.getTime()
    ) {
      throw new UnprocessableEntityException(
        'The policy expiry date must be after its inception date.',
      );
    }

    const limits = assertCoverageFigures(
      dto.schedule.limits,
      'schedule.limits',
    );
    const sumsInsured = assertCoverageFigures(
      dto.schedule.sumsInsured,
      'schedule.sumsInsured',
    );
    const scheduleEffectiveFrom = dto.schedule.effectiveFrom
      ? parseCalendarDate(dto.schedule.effectiveFrom, 'schedule.effectiveFrom')
      : (effectiveInception ?? new Date());

    const documentInputs: PolicyDocumentInput[] = dto.documents.map((d) => ({
      category: d.category,
      classification: d.classification,
      fileName: d.fileName,
      storageRef: d.storageRef,
      uploadedByUserId: actor.id,
    }));

    const hasOpenSchedule = policy.schedules.some(
      (s) => s.effectiveTo === null,
    );

    let resumed = false;
    if (policy.status === 'PLACEMENT_CONFIRMED') {
      // Normal path: flip the status and persist the issued scalars in one
      // atomic, engine-audited write. The engine's status-conditional
      // updateMany is the race gate — a concurrent issuance matches 0 rows
      // and gets a ConflictException (mapped to 409).
      const data: Record<string, unknown> = {
        policyNumber: dto.policyNumber,
        issuedPremium,
        issuedByUserId: actor.id,
      };
      if (inceptionOverride) data.inceptionDate = inceptionOverride;
      if (expiryOverride) data.expiryDate = expiryOverride;
      try {
        await this.workflow.transition({
          entityType: 'Policy',
          entityId: id,
          toStatus: 'ISSUED',
          actorUserId: actor.id,
          data,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException(
            `Policy number "${dto.policyNumber}" is already in use by another policy.`,
          );
        }
        throw err;
      }
    } else if (
      policy.status === 'ISSUED' &&
      !hasOpenSchedule &&
      policy.policyNumber === dto.policyNumber &&
      policy.issuedPremium !== null &&
      compareMoney(policy.issuedPremium, issuedPremium) === 0
    ) {
      // Crash-recovery re-entry: a prior call flipped the status + persisted
      // (and TRANSITION-audited) the issued scalars, then the artefact
      // `$transaction` failed and rolled back entirely. Do NOT re-transition
      // and do NOT rewrite the issued scalars — only the missing schedule +
      // documents are created here, from THIS call's payload (there is no
      // half-written first attempt to reconcile against). The scalar match
      // (`policyNumber` + `compareMoney(issuedPremium)`) is what distinguishes
      // this legitimate resume from a fresh issuance attempt on an
      // already-issued policy (which falls through to the 422 below).
      resumed = true;
      this.logger.warn(
        `Policy ${id}: resuming a partially-completed issuance (status already ISSUED, no open schedule).`,
      );
    } else {
      throw new UnprocessableEntityException(
        `Policy ${id} is ${policy.status}; issuance is recorded once, from PLACEMENT_CONFIRMED.`,
      );
    }

    let artifacts: Awaited<
      ReturnType<PolicyRepository['createIssuanceArtifacts']>
    >;
    try {
      artifacts = await this.policies.createIssuanceArtifacts(
        id,
        {
          effectiveFrom: scheduleEffectiveFrom,
          limits,
          sumsInsured,
          namedPerils: dto.schedule.namedPerils ?? [],
          extensions: dto.schedule.extensions ?? [],
        },
        documentInputs,
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        // The partial UNIQUE PolicySchedule_one_open_per_policy fired — a
        // concurrent issuance / re-entry already opened the schedule.
        throw new ConflictException(
          `Policy ${id} issuance artefacts were recorded concurrently.`,
        );
      }
      throw err;
    }

    if (!resumed) {
      // The issued Policy columns changed on this call — record the values the
      // engine's TRANSITION row (before/after `status`) does not capture. On a
      // resume nothing on the Policy row changed (the first attempt already
      // wrote + TRANSITION-audited the scalars), so no UPDATE row is emitted
      // and `issuedByUserId` here is always the actor who actually issued.
      await this.safeAudit({
        userId: actor.id,
        action: 'UPDATE',
        entityType: 'Policy',
        entityId: id,
        afterValue: policyIssuanceAuditSnapshot({
          policyNumber: dto.policyNumber,
          issuedPremium,
          issuedByUserId: actor.id,
          scheduleEffectiveFrom,
          documentCount: documentInputs.length,
        }),
      });
    }
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'PolicySchedule',
      entityId: artifacts.schedule.id,
      afterValue: policyScheduleAuditSnapshot(artifacts.schedule),
    });
    for (const doc of artifacts.documents) {
      await this.safeAudit({
        userId: actor.id,
        action: 'CREATE',
        entityType: 'Document',
        entityId: doc.id,
        afterValue: policyDocumentAuditSnapshot(doc),
      });
    }

    return this.toView(await this.loadVisible(id, actor));
  }

  async attachDocuments(
    id: string,
    dto: AttachPolicyDocumentsDto,
    actor: AuthenticatedUser,
  ): Promise<PolicyView> {
    await this.loadVisible(id, actor);

    const inputs: PolicyDocumentInput[] = dto.documents.map((d) => ({
      category: d.category,
      classification: d.classification,
      fileName: d.fileName,
      storageRef: d.storageRef,
      uploadedByUserId: actor.id,
    }));
    const created = await this.policies.attachDocuments(id, inputs);

    for (const doc of created) {
      await this.safeAudit({
        userId: actor.id,
        action: 'CREATE',
        entityType: 'Document',
        entityId: doc.id,
        afterValue: policyDocumentAuditSnapshot(doc),
      });
    }

    return this.toView(await this.loadVisible(id, actor));
  }

  async list(
    query: ListPoliciesQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PolicyView[]> {
    const scopes = [query.opportunityId, query.customerId].filter(
      (v) => v != null,
    );
    if (scopes.length !== 1) {
      throw new UnprocessableEntityException(
        'Provide exactly one of opportunityId or customerId.',
      );
    }

    if (query.opportunityId) {
      await this.loadVisibleOpportunity(query.opportunityId, actor);
      const row = await this.policies.findByOpportunityId(query.opportunityId);
      return row ? [this.toView(row)] : [];
    }

    await this.assertCustomerVisible(query.customerId as string, actor);
    const rows = await this.policies.findManyByCustomerId(
      query.customerId as string,
    );
    return rows.map((r) => this.toView(r));
  }

  async get(id: string, actor: AuthenticatedUser): Promise<PolicyView> {
    return this.toView(await this.loadVisible(id, actor));
  }
}
