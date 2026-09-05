import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { NeedsAssessment } from '@ibms/db';
import {
  NeedsAssessmentRepository,
  type NeedsAssessmentFilter,
} from '../../repositories/needs-assessment.repository';
import { RiskProfileRepository } from '../../repositories/risk-profile.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { assertDifferentActors } from '../../common/maker-checker.util';
import { CUSTOMER_FILE_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import {
  deriveRecommendedCoverageLines,
  parseQuestionnaireAnswers,
} from './needs-assessment.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateNeedsAssessmentDto } from './dto/create-needs-assessment.dto';
import type { UpdateNeedsAssessmentDto } from './dto/update-needs-assessment.dto';
import type { ListNeedsAssessmentsQueryDto } from './dto/list-needs-assessments-query.dto';

/**
 * Process 5 — Needs Assessment (backlog Part C #5, Domain A). A structured
 * questionnaire that derives a recommended coverage list, then goes through
 * a review + approval gate before it can feed an Opportunity/RFQ.
 *
 * Status moves ONLY through WorkflowTransitionService (A.6) —
 * ibms-brain/meta/lex/workflow-state-transitions.md. The chain (see
 * workflow-transitions.config.ts):
 *
 *   DRAFT -[submit]-> PENDING_REVIEW
 *     -[review]->  REVIEWED  (stamps reviewedByUserId)
 *     -[approve]-> APPROVED  (stamps approvedByUserId; terminal — linking to
 *                             an Opportunity/RFQ is Process 11+, not built)
 *   PENDING_REVIEW | REVIEWED -[return]-> DRAFT   (clears reviewedByUserId)
 *   PENDING_REVIEW | REVIEWED -[reject]-> REJECTED (terminal)
 *
 * Maker/checker (A.5, ibms-brain/meta/lex/maker-checker-segregation.md): the
 * `needs-assessment.approve` role (Branch/Department Manager) that reviews,
 * approves, or rejects must be a different user than `createdByUserId` (the
 * Sales/Relationship Officer who captured it). `assertDifferentActors()` is
 * the application guard; a DB CHECK on both `reviewedByUserId` and
 * `approvedByUserId` is the backstop. The manager who records the review and
 * the one who approves MAY be the same person (no source requires them to
 * differ) — only the capturer is excluded from both.
 *
 * Visibility: the Sales Officer who captured an assessment sees it;
 * Placement/Manager/Executive (CUSTOMER_FILE_CROSS_OWNER_ROLES) see the
 * whole book. The manager decision actions are queue-style — any
 * `needs-assessment.approve` holder can act on any assessment, matching the
 * seeded grid's role-level (not instance-level) design, same as the KYC
 * queue.
 */
@Injectable()
export class NeedsAssessmentService {
  private readonly logger = new Logger(NeedsAssessmentService.name);

  constructor(
    private readonly assessments: NeedsAssessmentRepository,
    private readonly riskProfiles: RiskProfileRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
  ) {}

  private canViewAll(actor: AuthenticatedUser): boolean {
    return actor.roles.some((role) =>
      (CUSTOMER_FILE_CROSS_OWNER_ROLES as readonly string[]).includes(role),
    );
  }

  /** Logged, not thrown — the real write already committed; an audit hiccup
   * must not turn a successful operation into a reported failure (same
   * philosophy as CustomerService/ProspectService and the workflow engine's
   * own sideEffect catch). */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `NeedsAssessment ${input.entityId}: audit record (${input.action}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** find-or-404 with the creator/visibility gate applied. */
  private async findVisible(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<NeedsAssessment> {
    const assessment = await this.assessments.findById(id);
    if (
      !assessment ||
      (!this.canViewAll(actor) && assessment.createdByUserId !== actor.id)
    ) {
      throw new NotFoundException('NeedsAssessment not found');
    }
    return assessment;
  }

  /** Re-read after a transition — WorkflowTransitionService.transition()
   * returns only the narrow `{ id, status }` shape (same pattern as
   * KycService.mustFind()). */
  private async mustFind(id: string): Promise<NeedsAssessment> {
    const assessment = await this.assessments.findById(id);
    if (!assessment) {
      throw new NotFoundException(`NeedsAssessment ${id} not found`);
    }
    return assessment;
  }

  /** A Needs Assessment inherits its visibility from its Risk Profile's
   * Customer. NotFoundException for a missing Risk Profile, a missing
   * Customer, or one the caller can't see — no existence oracle. */
  private async assertRiskProfileVisible(
    riskProfileId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const riskProfile = await this.riskProfiles.findById(riskProfileId);
    if (!riskProfile) {
      throw new NotFoundException('RiskProfile not found');
    }
    const customer = await this.customers.findById(riskProfile.customerId);
    if (
      !customer ||
      (!this.canViewAll(actor) && customer.ownerUserId !== actor.id)
    ) {
      throw new NotFoundException('RiskProfile not found');
    }
  }

  async create(
    dto: CreateNeedsAssessmentDto,
    actor: AuthenticatedUser,
  ): Promise<NeedsAssessment> {
    await this.assertRiskProfileVisible(dto.riskProfileId, actor);

    const answers = parseQuestionnaireAnswers(dto.questionnaireAnswers);
    const recommendedCoverageLines = deriveRecommendedCoverageLines(answers);

    const assessment = await this.assessments.create({
      riskProfileId: dto.riskProfileId,
      questionnaireAnswers: answers,
      recommendedCoverageLines,
      createdByUserId: actor.id,
    });

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'NeedsAssessment',
      entityId: assessment.id,
      afterValue: {
        riskProfileId: assessment.riskProfileId,
        status: assessment.status,
        recommendedCoverageLines,
      },
    });

    return assessment;
  }

  async update(
    id: string,
    dto: UpdateNeedsAssessmentDto,
    actor: AuthenticatedUser,
  ): Promise<NeedsAssessment> {
    const assessment = await this.findVisible(id, actor);
    // Only the capturer edits their own draft — a cross-owner viewer
    // (Placement/Manager/Exec) can read it but not rewrite the questionnaire.
    if (assessment.createdByUserId !== actor.id) {
      throw new NotFoundException('NeedsAssessment not found');
    }
    if (assessment.status !== 'DRAFT') {
      throw new UnprocessableEntityException(
        `NeedsAssessment ${id}: the questionnaire can only be edited while in DRAFT (this one is ${assessment.status}).`,
      );
    }

    const answers = parseQuestionnaireAnswers(dto.questionnaireAnswers);
    const recommendedCoverageLines = deriveRecommendedCoverageLines(answers);
    const updated = await this.assessments.updateQuestionnaire(id, {
      questionnaireAnswers: answers,
      recommendedCoverageLines,
    });

    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'NeedsAssessment',
      entityId: id,
      afterValue: { recommendedCoverageLines },
    });

    return updated;
  }

  /** DRAFT -> PENDING_REVIEW. Owner-only (needs-assessment.create). */
  async submit(id: string, actor: AuthenticatedUser): Promise<NeedsAssessment> {
    const assessment = await this.findVisible(id, actor);
    if (assessment.createdByUserId !== actor.id) {
      throw new NotFoundException('NeedsAssessment not found');
    }
    await this.workflow.transition({
      entityType: 'NeedsAssessment',
      entityId: id,
      toStatus: 'PENDING_REVIEW',
      actorUserId: actor.id,
    });
    return this.mustFind(id);
  }

  /** PENDING_REVIEW -> REVIEWED, stamping reviewedByUserId. Manager-only
   * (needs-assessment.approve), maker/checker-gated against the capturer. */
  async review(id: string, actor: AuthenticatedUser): Promise<NeedsAssessment> {
    const assessment = await this.mustFind(id);
    assertDifferentActors(
      assessment.createdByUserId,
      actor.id,
      'NeedsAssessment.review',
    );
    await this.workflow.transition({
      entityType: 'NeedsAssessment',
      entityId: id,
      toStatus: 'REVIEWED',
      actorUserId: actor.id,
      data: { reviewedByUserId: actor.id },
    });
    return this.mustFind(id);
  }

  /** REVIEWED -> APPROVED, stamping approvedByUserId. Manager-only
   * (needs-assessment.approve), maker/checker-gated against the capturer.
   * APPROVED is terminal — linking to an Opportunity/RFQ is Process 11+. */
  async approve(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<NeedsAssessment> {
    const assessment = await this.mustFind(id);
    assertDifferentActors(
      assessment.createdByUserId,
      actor.id,
      'NeedsAssessment.approve',
    );
    await this.workflow.transition({
      entityType: 'NeedsAssessment',
      entityId: id,
      toStatus: 'APPROVED',
      actorUserId: actor.id,
      data: { approvedByUserId: actor.id },
    });
    await this.safeAudit({
      userId: actor.id,
      action: 'APPROVE',
      entityType: 'NeedsAssessment',
      entityId: id,
      afterValue: { approvedByUserId: actor.id },
    });
    return this.mustFind(id);
  }

  /** PENDING_REVIEW | REVIEWED -> DRAFT — sent back to the capturer for
   * changes. Clears reviewedByUserId (any prior review is stale once the
   * questionnaire can change again). A reason is required. */
  async returnToDraft(
    id: string,
    reason: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<NeedsAssessment> {
    await this.mustFind(id);
    if (!reason?.trim()) {
      throw new BadRequestException(
        'Returning a Needs Assessment for changes requires a stated reason.',
      );
    }
    await this.workflow.transition({
      entityType: 'NeedsAssessment',
      entityId: id,
      toStatus: 'DRAFT',
      actorUserId: actor.id,
      data: { reviewedByUserId: null },
    });
    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'NeedsAssessment',
      entityId: id,
      afterValue: { returnedToDraft: true, reason },
    });
    return this.mustFind(id);
  }

  /** PENDING_REVIEW | REVIEWED -> REJECTED (terminal). A reason is required.
   * Maker/checker-gated against the capturer. */
  async reject(
    id: string,
    reason: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<NeedsAssessment> {
    const assessment = await this.mustFind(id);
    assertDifferentActors(
      assessment.createdByUserId,
      actor.id,
      'NeedsAssessment.reject',
    );
    if (!reason?.trim()) {
      throw new BadRequestException(
        'Rejecting a Needs Assessment requires a stated reason.',
      );
    }
    await this.workflow.transition({
      entityType: 'NeedsAssessment',
      entityId: id,
      toStatus: 'REJECTED',
      actorUserId: actor.id,
    });
    await this.safeAudit({
      userId: actor.id,
      action: 'REJECT',
      entityType: 'NeedsAssessment',
      entityId: id,
      afterValue: { reason },
    });
    return this.mustFind(id);
  }

  list(
    query: ListNeedsAssessmentsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<NeedsAssessment[]> {
    const filter: NeedsAssessmentFilter = {
      riskProfileId: query.riskProfileId,
      status: query.status,
      createdByUserId: this.canViewAll(actor) ? undefined : actor.id,
    };
    return this.assessments.findMany(filter);
  }

  get(id: string, actor: AuthenticatedUser): Promise<NeedsAssessment> {
    return this.findVisible(id, actor);
  }
}
