import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { OpportunityStatus, Recommendation } from '@ibms/db';
import {
  RecommendationRepository,
  type RecommendationWithContext,
} from '../../repositories/recommendation.repository';
import { OpportunityRepository } from '../../repositories/opportunity.repository';
import { QuotationRepository } from '../../repositories/quotation.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { CUSTOMER_FILE_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import { assertDifferentActors } from '../../common/maker-checker.util';
import {
  approvalRequired,
  commissionDiffAgainst,
  detectConflictOfInterest,
  formatMoney,
  normalizeRecommendationRationale,
  recommendationAuditSnapshot,
  type CoiQuote,
} from './recommendation.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { DraftRecommendationDto } from './dto/draft-recommendation.dto';
import type { DiscloseConflictOfInterestDto } from './dto/disclose-conflict-of-interest.dto';
import type { ListRecommendationsQueryDto } from './dto/list-recommendations-query.dto';

/** The recommendation as the API returns it. `blockedFromSend` lists the
 * gates that still stand between the current state and `send` — empty means
 * "ready to send". */
export interface RecommendationView {
  id: string;
  opportunityId: string;
  customerId: string;
  recommendedQuotation: {
    id: string;
    insurerId: string;
    insurer: RecommendationWithContext['recommendedQuotation']['insurer'];
    insuranceLine: string;
    premium: string;
    currency: string;
    commissionRatePercent: string | null;
  };
  rationale: string;
  rationaleFactors: Record<string, string>;
  approvalRequired: boolean;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  conflictOfInterestFlagged: boolean;
  coiCompetingQuotationId: string | null;
  coiCommissionDiffPercent: string | null;
  conflictOfInterestDisclosure: {
    id: string;
    competingQuotationId: string | null;
    commissionDifferencePercent: string | null;
    disclosureText: string;
    acknowledgedByUserId: string;
    acknowledgedAt: Date;
  } | null;
  sentToClientAt: Date | null;
  sentByUserId: string | null;
  draftedByUserId: string;
  createdAt: Date;
  blockedFromSend: string[];
}

const P2002 = 'P2002';
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
  );
}

/**
 * Process 16 — Broker Recommendation (backlog Part C #16, Domain B).
 *
 *  - `draft` — one `Recommendation` per Opportunity (`opportunityId
 *    @unique`), pointing at one **current-version** `Quotation` on one of the
 *    Opportunity's RFQs. The documented rationale must address all six
 *    factors (coverage / price / financial strength / claims service /
 *    deductible / policy conditions — never price alone). Two gate flags are
 *    snapshotted at draft: `approvalRequired` (premium over the Opportunity's
 *    `targetPremiumThreshold`) and `conflictOfInterestFlagged` (a comparable
 *    competing quote carried a materially lower commission rate). A draft
 *    best-effort advances `Opportunity COMPARISON_BUILT ->
 *    RECOMMENDATION_DRAFTED`.
 *  - `approve` — senior officer (`recommendation.approve`), only meaningful
 *    when `approvalRequired`. Maker/checker: `assertDifferentActors` +
 *    the `Recommendation_maker_checker_distinct` CHECK constraint. Stamps
 *    `approvedByUserId` / `approvedAt` through a status-conditional write.
 *  - `discloseConflictOfInterest` — records the mandatory disclosure for a
 *    flagged recommendation; the acknowledger must differ from the drafter.
 *  - `send` — stamps `sentToClientAt` and advances `Opportunity
 *    RECOMMENDATION_DRAFTED -> SENT_TO_CLIENT`. Refuses (422) while an
 *    approval is required-but-missing, or a COI disclosure is
 *    flagged-but-missing.
 *
 * `Recommendation` is NOT a `WorkflowTransitionService` entity (no `status`
 * column) — its lifecycle is nullable timestamps, and the parent Opportunity
 * carries the same progression through the engine. Visibility mirrors
 * `ComparisonService` / `QuotationService`: a recommendation inherits its
 * Opportunity's Customer's visibility.
 */
@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly recommendations: RecommendationRepository,
    private readonly opportunities: OpportunityRepository,
    private readonly quotations: QuotationRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
  ) {}

  /** Placement / Manager / Executive work the whole commercial book
   * (`CUSTOMER_FILE_CROSS_OWNER_ROLES`), and a Compliance Officer must be
   * able to reach any recommendation to clear its conflict-of-interest
   * disclosure — `conflict-of-interest.disclose` is a Compliance grant, and
   * the conflicted officer cannot self-clear (maker/checker). Sales sees
   * only recommendations on a Customer they own. */
  private canReachAnyCustomer(actor: AuthenticatedUser): boolean {
    return actor.roles.some(
      (role) =>
        (CUSTOMER_FILE_CROSS_OWNER_ROLES as readonly string[]).includes(role) ||
        role === 'COMPLIANCE_OFFICER',
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
        `Recommendation audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed`,
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
   * Customer; every failure mode collapses to one NotFoundException with the
   * given label (no existence oracle). */
  private async loadVisibleOpportunity(
    opportunityId: string,
    actor: AuthenticatedUser,
    label: string,
  ): Promise<{
    id: string;
    customerId: string;
    status: OpportunityStatus;
    targetPremiumThreshold: Prisma.Decimal | null;
  }> {
    const opportunity = await this.opportunities.findById(opportunityId);
    if (!opportunity) {
      throw new NotFoundException(label);
    }
    try {
      await this.assertCustomerVisible(opportunity.customerId, actor);
    } catch {
      throw new NotFoundException(label);
    }
    return {
      id: opportunity.id,
      customerId: opportunity.customerId,
      status: opportunity.status,
      targetPremiumThreshold: opportunity.targetPremiumThreshold,
    };
  }

  /** Loads a recommendation + resolves visibility through its Opportunity. */
  private async loadVisible(
    id: string,
    actor: AuthenticatedUser,
    label = 'Recommendation not found',
  ): Promise<RecommendationWithContext> {
    const recommendation = await this.recommendations.findById(id);
    if (!recommendation) {
      throw new NotFoundException(label);
    }
    try {
      await this.assertCustomerVisible(
        recommendation.opportunity.customerId,
        actor,
      );
    } catch {
      throw new NotFoundException(label);
    }
    return recommendation;
  }

  /** Best-effort Opportunity advance. Logged, never thrown — not
   * authoritative (derive "a recommendation exists / was sent" from the
   * `Recommendation` table). */
  private async advanceOpportunity(
    opportunityId: string,
    from: OpportunityStatus,
    to: OpportunityStatus,
    currentStatus: OpportunityStatus,
    actorUserId: string,
  ): Promise<void> {
    if (currentStatus !== from) return;
    try {
      await this.workflow.transition({
        entityType: 'Opportunity',
        entityId: opportunityId,
        toStatus: to,
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `Recommendation moved for Opportunity ${opportunityId} but the ${from} -> ${to} transition did not apply: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The **effective** send-gates — re-derived from LIVE data and OR'd with
   * the draft-time snapshot, so a gate can be *added* after draft (a
   * threshold configured, or a comparable competitor quoting a lower
   * commission) but never silently *cleared*. The snapshot columns
   * (`approvalRequired` / `conflictOfInterestFlagged` / `coiCompeting*`)
   * stay the draft-time record; this is what `send` / `approve` / `disclose`
   * and every view actually gate on. (`@code-reviewer` MAJOR, Part C #16 —
   * "a control that fires only when a human configured data in the right
   * order before draft is procedural, not structural".)
   *
   * COI competitors are scoped to the recommended quote's own RFQ line — a
   * quote on a different insurance line is not a "comparable competing
   * offer" (`policy-lifecycle.md` § "The rules that aren't obvious"), and
   * this matches #14's per-RFQ `ComparisonMatrix` scoping.
   */
  private async effectiveGates(rec: RecommendationWithContext): Promise<{
    approvalRequired: boolean;
    conflictOfInterestFlagged: boolean;
    coiCompetingQuotationId: string | null;
    coiCommissionDiffPercent: string | null;
  }> {
    const q = rec.recommendedQuotation;

    const liveApproval = approvalRequired(
      q.premium,
      rec.opportunity.targetPremiumThreshold,
    );

    const competitors: CoiQuote[] = (
      await this.quotations.findManyByRfqId(q.rfqId)
    )
      .filter((c) => c.isCurrentVersion && c.id !== q.id)
      .map((c) => ({
        id: c.id,
        insurerId: c.insurerId,
        premium: c.premium,
        commissionRatePercent: c.commissionRatePercent,
      }));
    const liveCoi = detectConflictOfInterest(
      {
        id: q.id,
        insurerId: q.insurerId,
        premium: q.premium,
        commissionRatePercent: q.commissionRatePercent,
      },
      competitors,
    );

    return {
      approvalRequired: rec.approvalRequired || liveApproval,
      conflictOfInterestFlagged:
        rec.conflictOfInterestFlagged || liveCoi.flagged,
      coiCompetingQuotationId:
        rec.coiCompetingQuotationId ?? liveCoi.competingQuotationId,
      coiCommissionDiffPercent:
        rec.coiCommissionDiffPercent !== null
          ? rec.coiCommissionDiffPercent.toFixed(2)
          : liveCoi.commissionDiffPercent,
    };
  }

  private computeBlocked(
    rec: RecommendationWithContext,
    gates: { approvalRequired: boolean; conflictOfInterestFlagged: boolean },
  ): string[] {
    if (rec.sentToClientAt) return [];
    const blocked: string[] = [];
    if (gates.approvalRequired && rec.approvedAt === null) {
      blocked.push(
        'Senior-officer approval is required (recommended premium exceeds the Opportunity target threshold).',
      );
    }
    if (
      gates.conflictOfInterestFlagged &&
      rec.conflictOfInterestDisclosure === null
    ) {
      blocked.push(
        'A conflict-of-interest disclosure is required before this recommendation can be sent.',
      );
    }
    return blocked;
  }

  private async toView(
    rec: RecommendationWithContext,
  ): Promise<RecommendationView> {
    const q = rec.recommendedQuotation;
    const disc = rec.conflictOfInterestDisclosure;
    const gates = await this.effectiveGates(rec);
    return {
      id: rec.id,
      opportunityId: rec.opportunityId,
      customerId: rec.opportunity.customerId,
      recommendedQuotation: {
        id: q.id,
        insurerId: q.insurerId,
        insurer: q.insurer,
        insuranceLine: q.rfq.insuranceLine,
        premium: formatMoney(q.premium),
        currency: q.currency,
        commissionRatePercent:
          q.commissionRatePercent === null
            ? null
            : q.commissionRatePercent.toFixed(2),
      },
      rationale: rec.rationale,
      rationaleFactors: (rec.rationaleFactors ?? {}) as Record<string, string>,
      approvalRequired: gates.approvalRequired,
      approvedByUserId: rec.approvedByUserId,
      approvedAt: rec.approvedAt,
      conflictOfInterestFlagged: gates.conflictOfInterestFlagged,
      coiCompetingQuotationId: gates.coiCompetingQuotationId,
      coiCommissionDiffPercent: gates.coiCommissionDiffPercent,
      conflictOfInterestDisclosure: disc
        ? {
            id: disc.id,
            competingQuotationId: disc.competingQuotationId,
            commissionDifferencePercent:
              disc.commissionDifferencePercent == null
                ? null
                : disc.commissionDifferencePercent.toFixed(2),
            disclosureText: disc.disclosureText,
            acknowledgedByUserId: disc.acknowledgedByUserId,
            acknowledgedAt: disc.acknowledgedAt,
          }
        : null,
      sentToClientAt: rec.sentToClientAt,
      sentByUserId: rec.sentByUserId,
      draftedByUserId: rec.draftedByUserId,
      createdAt: rec.createdAt,
      blockedFromSend: this.computeBlocked(rec, gates),
    };
  }

  async draft(
    dto: DraftRecommendationDto,
    actor: AuthenticatedUser,
  ): Promise<RecommendationView> {
    const opportunity = await this.loadVisibleOpportunity(
      dto.opportunityId,
      actor,
      'Opportunity not found',
    );

    if (opportunity.status !== 'COMPARISON_BUILT') {
      throw new UnprocessableEntityException(
        `Opportunity ${opportunity.id} is ${opportunity.status}; a recommendation is drafted once the comparison is built (COMPARISON_BUILT).`,
      );
    }

    const recommended = await this.quotations.findById(
      dto.recommendedQuotationId,
    );
    if (!recommended || recommended.rfq.opportunityId !== opportunity.id) {
      throw new UnprocessableEntityException(
        `Quotation ${dto.recommendedQuotationId} is not a quote on Opportunity ${opportunity.id}.`,
      );
    }
    if (!recommended.isCurrentVersion) {
      throw new UnprocessableEntityException(
        `Quotation ${dto.recommendedQuotationId} is a superseded version — recommend the current version of its chain.`,
      );
    }

    const { rationale, rationaleFactors } = normalizeRecommendationRationale({
      rationale: dto.rationale,
      rationaleFactors: dto.rationaleFactors,
    });

    const needsApproval = approvalRequired(
      recommended.premium,
      opportunity.targetPremiumThreshold,
    );

    // Competitors scoped to the recommended quote's own RFQ line — a
    // cross-line quote is not a "comparable competing offer".
    const competitors: CoiQuote[] = (
      await this.quotations.findManyByRfqId(recommended.rfqId)
    )
      .filter((q) => q.isCurrentVersion && q.id !== recommended.id)
      .map((q) => ({
        id: q.id,
        insurerId: q.insurerId,
        premium: q.premium,
        commissionRatePercent: q.commissionRatePercent,
      }));
    const coi = detectConflictOfInterest(
      {
        id: recommended.id,
        insurerId: recommended.insurerId,
        premium: recommended.premium,
        commissionRatePercent: recommended.commissionRatePercent,
      },
      competitors,
    );

    let created: Recommendation;
    try {
      created = await this.recommendations.create({
        opportunityId: opportunity.id,
        recommendedQuotationId: recommended.id,
        draftedByUserId: actor.id,
        rationale,
        rationaleFactors,
        approvalRequired: needsApproval,
        conflictOfInterestFlagged: coi.flagged,
        coiCompetingQuotationId: coi.competingQuotationId,
        coiCommissionDiffPercent:
          coi.commissionDiffPercent === null
            ? null
            : new Prisma.Decimal(coi.commissionDiffPercent),
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A recommendation already exists for this Opportunity (or this quotation already backs one).`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Recommendation',
      entityId: created.id,
      afterValue: recommendationAuditSnapshot({
        opportunityId: created.opportunityId,
        recommendedQuotationId: created.recommendedQuotationId,
        draftedByUserId: created.draftedByUserId,
        approvalRequired: created.approvalRequired,
        conflictOfInterestFlagged: created.conflictOfInterestFlagged,
        coiCompetingQuotationId: created.coiCompetingQuotationId,
        coiCommissionDiffPercent: created.coiCommissionDiffPercent,
        rationale: created.rationale,
        rationaleFactors: created.rationaleFactors,
      }),
    });

    await this.advanceOpportunity(
      opportunity.id,
      'COMPARISON_BUILT',
      'RECOMMENDATION_DRAFTED',
      opportunity.status,
      actor.id,
    );

    return await this.toView(await this.loadVisible(created.id, actor));
  }

  async approve(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<RecommendationView> {
    const rec = await this.loadVisible(id, actor);
    const gates = await this.effectiveGates(rec);

    if (!gates.approvalRequired) {
      throw new UnprocessableEntityException(
        `Recommendation ${id} is below the Opportunity's target premium threshold — it needs no senior-officer approval.`,
      );
    }
    if (rec.approvedAt !== null) {
      throw new ConflictException(
        `Recommendation ${id} has already been approved.`,
      );
    }
    assertDifferentActors(
      rec.draftedByUserId,
      actor.id,
      'Recommendation.approve',
    );

    const updated = await this.recommendations.recordApproval(id, actor.id);
    if (updated === null) {
      throw new ConflictException(
        `Recommendation ${id} was approved concurrently.`,
      );
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'Recommendation',
      entityId: id,
      afterValue: {
        approvedByUserId: actor.id,
        approvalRequired: true,
      },
    });

    return await this.toView(await this.loadVisible(id, actor));
  }

  async discloseConflictOfInterest(
    id: string,
    dto: DiscloseConflictOfInterestDto,
    actor: AuthenticatedUser,
  ): Promise<RecommendationView> {
    const rec = await this.loadVisible(id, actor);
    const gates = await this.effectiveGates(rec);

    if (!gates.conflictOfInterestFlagged) {
      throw new UnprocessableEntityException(
        `Recommendation ${id} was not flagged for a conflict of interest — no disclosure is required.`,
      );
    }
    if (rec.conflictOfInterestDisclosure !== null) {
      throw new ConflictException(
        `Recommendation ${id} already has a conflict-of-interest disclosure.`,
      );
    }
    assertDifferentActors(
      rec.draftedByUserId,
      actor.id,
      'ConflictOfInterestDisclosure.acknowledge',
    );

    // Resolve which competing quote this disclosure is against. Default to
    // the flagged competitor (draft-time snapshot, or the live-detected one
    // if COI only became flagged after draft). A supplied override is a
    // **deliberate human choice** — the discloser may know of a competing
    // offer the heuristic did not rank as "comparable" (e.g. a verbal
    // indication); it is only checked to be a current-version quote on this
    // Opportunity and not the recommended one, and `commissionDiffAgainst`
    // then records whatever the rate gap is (it may be small or negative).
    let competingQuotationId = gates.coiCompetingQuotationId;
    let commissionDiff: Prisma.Decimal | null =
      gates.coiCommissionDiffPercent === null
        ? null
        : new Prisma.Decimal(gates.coiCommissionDiffPercent);
    if (dto.competingQuotationId) {
      if (dto.competingQuotationId === rec.recommendedQuotationId) {
        throw new UnprocessableEntityException(
          'competingQuotationId cannot be the recommended quotation.',
        );
      }
      const competing = await this.quotations.findById(
        dto.competingQuotationId,
      );
      if (
        !competing ||
        competing.rfq.opportunityId !== rec.opportunityId ||
        !competing.isCurrentVersion
      ) {
        throw new UnprocessableEntityException(
          `Quotation ${dto.competingQuotationId} is not a current-version quote on this Opportunity.`,
        );
      }
      competingQuotationId = competing.id;
      commissionDiff =
        rec.recommendedQuotation.commissionRatePercent !== null &&
        competing.commissionRatePercent !== null
          ? new Prisma.Decimal(
              commissionDiffAgainst(
                rec.recommendedQuotation.commissionRatePercent,
                competing.commissionRatePercent,
              ),
            )
          : null;
    }

    let disclosure: { id: string };
    try {
      disclosure = await this.recommendations.createDisclosure({
        recommendationId: id,
        competingQuotationId,
        commissionDifferencePercent: commissionDiff,
        disclosureText: dto.disclosureText,
        acknowledgedByUserId: actor.id,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Recommendation ${id} already has a conflict-of-interest disclosure.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'ConflictOfInterestDisclosure',
      entityId: disclosure.id,
      afterValue: {
        recommendationId: id,
        competingQuotationId,
        commissionDifferencePercent:
          commissionDiff === null ? null : commissionDiff.toFixed(2),
        acknowledgedByUserId: actor.id,
      },
    });

    return await this.toView(await this.loadVisible(id, actor));
  }

  async send(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<RecommendationView> {
    const rec = await this.loadVisible(id, actor);

    if (rec.sentToClientAt !== null) {
      throw new ConflictException(
        `Recommendation ${id} has already been sent to the client.`,
      );
    }
    // Gates are re-derived from live data, not the draft-time snapshot, so a
    // threshold set — or a comparable competitor quoted — after the draft
    // still blocks the send (`@code-reviewer` MAJOR, Part C #16).
    const gates = await this.effectiveGates(rec);
    const blocked = this.computeBlocked(rec, gates);
    if (blocked.length > 0) {
      throw new UnprocessableEntityException(blocked.join(' '));
    }

    const updated = await this.recommendations.recordSent(id, actor.id);
    if (updated === null) {
      throw new ConflictException(
        `Recommendation ${id} was sent concurrently.`,
      );
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'Recommendation',
      entityId: id,
      afterValue: {
        sentByUserId: actor.id,
        approvalRequired: gates.approvalRequired,
        conflictOfInterestFlagged: gates.conflictOfInterestFlagged,
      },
    });

    await this.advanceOpportunity(
      rec.opportunityId,
      'RECOMMENDATION_DRAFTED',
      'SENT_TO_CLIENT',
      rec.opportunity.status,
      actor.id,
    );

    return await this.toView(await this.loadVisible(id, actor));
  }

  async list(
    query: ListRecommendationsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<RecommendationView[]> {
    const scopes = [query.opportunityId, query.customerId].filter(
      (v) => v != null,
    );
    if (scopes.length !== 1) {
      throw new UnprocessableEntityException(
        'Provide exactly one of opportunityId or customerId.',
      );
    }

    if (query.opportunityId) {
      await this.loadVisibleOpportunity(
        query.opportunityId,
        actor,
        'Opportunity not found',
      );
      const rec = await this.recommendations.findByOpportunityId(
        query.opportunityId,
      );
      return rec ? [await this.toView(rec)] : [];
    }

    await this.assertCustomerVisible(query.customerId as string, actor);
    const rows = await this.recommendations.findManyByCustomerId(
      query.customerId as string,
    );
    // One recommendation per Opportunity, so a customer has only a handful —
    // the per-row live-gate query in `toView` is not a hot path.
    return Promise.all(rows.map((r) => this.toView(r)));
  }

  async get(id: string, actor: AuthenticatedUser): Promise<RecommendationView> {
    return await this.toView(await this.loadVisible(id, actor));
  }
}
