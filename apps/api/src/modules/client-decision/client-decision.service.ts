import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type {
  ClientDecision,
  ClientDecisionType,
  OpportunityStatus,
} from '@ibms/db';
import {
  ClientDecisionRepository,
  type ClientDecisionWithContext,
} from '../../repositories/client-decision.repository';
import { OpportunityRepository } from '../../repositories/opportunity.repository';
import { RecommendationRepository } from '../../repositories/recommendation.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { CUSTOMER_FILE_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import {
  clientDecisionAuditSnapshot,
  routeFor,
  routeLabel,
  type ClientDecisionRoute,
} from './client-decision.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CaptureClientDecisionDto } from './dto/capture-client-decision.dto';
import type { ListClientDecisionsQueryDto } from './dto/list-client-decisions-query.dto';

/** A captured client decision as the API returns it. `route` is the single
 * Opportunity path this decision takes; `routingComplete` is whether the
 * parent Opportunity has actually reached it (the routing transitions are
 * best-effort — see below). */
export interface ClientDecisionView {
  id: string;
  opportunityId: string;
  customerId: string;
  decision: ClientDecisionType;
  route: ClientDecisionRoute;
  routeLabel: string;
  evidenceType: string | null;
  evidenceRef: string | null;
  notes: string | null;
  capturedByUserId: string | null;
  decidedAt: Date;
  opportunityStatus: OpportunityStatus;
  routingComplete: boolean;
}

/** The Opportunity path a client decision walks: from wherever the
 * Opportunity currently sits, through `CLIENT_DECISION`, to the decision's
 * route. Indexed so a lagging #16 best-effort advance (Opportunity still at
 * RECOMMENDATION_DRAFTED though the Recommendation was sent) is caught up. */
const ROUTE_PATH_FROM: Partial<Record<OpportunityStatus, number>> = {
  RECOMMENDATION_DRAFTED: 0,
  SENT_TO_CLIENT: 1,
  CLIENT_DECISION: 2,
};

/**
 * Process 17 — Client Decision Handling (backlog Part C #17, Domain B).
 *
 *  - `capture` — record the client's single decision on a **sent**
 *    Recommendation (one `ClientDecision` per Opportunity, `opportunityId
 *    @unique`). The six `ClientDecisionType` values collapse to three routes
 *    (`routeFor`): ACCEPT -> PLACEMENT, REJECT -> CLOSED_LOST, the four
 *    REQUEST_* -> RENEGOTIATE. The route is the parent Opportunity's engine
 *    transition (`... -> CLIENT_DECISION -> <route>`), applied **best-effort**
 *    (logged, never thrown — the `ClientDecision` row + `routeFor(decision)`
 *    is the authoritative record of the decision and where it goes; the
 *    Opportunity status catching up is secondary, same philosophy as
 *    `RecommendationService`'s advances). `routingComplete` on the view
 *    reports whether it landed.
 *  - `list` / `get` — read the decision, scoped to exactly one of
 *    `opportunityId` / `customerId`.
 *
 * `ClientDecision` is NOT a `WorkflowTransitionService` entity (`decision`
 * is a one-shot enum, not a state machine) and has no maker/checker
 * (recording the client's stated decision is a factual, single-actor
 * Sales/Placement act). Visibility mirrors `RecommendationService`: a
 * decision inherits its Opportunity's Customer's visibility.
 */
@Injectable()
export class ClientDecisionService {
  private readonly logger = new Logger(ClientDecisionService.name);

  constructor(
    private readonly clientDecisions: ClientDecisionRepository,
    private readonly opportunities: OpportunityRepository,
    private readonly recommendations: RecommendationRepository,
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
        `ClientDecision audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed`,
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
   * Customer; every failure mode collapses to one NotFoundException. */
  private async loadVisibleOpportunity(
    opportunityId: string,
    actor: AuthenticatedUser,
    label: string,
  ): Promise<{
    id: string;
    customerId: string;
    status: OpportunityStatus;
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
    };
  }

  /**
   * Best-effort: walk the Opportunity through `... -> SENT_TO_CLIENT ->
   * CLIENT_DECISION -> <route>` to the decision's route. Logged, never
   * thrown — the `ClientDecision` row + `routeFor(decision)` is already the
   * authoritative record.
   *
   * The **live** Opportunity status is re-read before every hop, so the walk
   * is self-healing under concurrency: a hop that a retried #16 advance (or
   * any other actor) already applied is simply skipped, not treated as a
   * failure. It stops only when the route is reached, when a hop genuinely
   * fails (`transition` throws — an illegal move or a lost race), or when the
   * status lands somewhere the path does not run from.
   */
  private async routeOpportunity(
    opportunityId: string,
    route: ClientDecisionRoute,
    actorUserId: string,
  ): Promise<void> {
    const fullPath: OpportunityStatus[] = [
      'SENT_TO_CLIENT',
      'CLIENT_DECISION',
      route,
    ];
    // At most one read + one transition per path entry, plus a final
    // "are we there yet" read — the +1 bounds the loop against a bug.
    for (let hop = 0; hop <= fullPath.length; hop += 1) {
      const opportunity = await this.opportunities.findById(opportunityId);
      if (!opportunity || opportunity.status === route) return;

      const index = ROUTE_PATH_FROM[opportunity.status];
      if (index === undefined) {
        this.logger.warn(
          `ClientDecision for Opportunity ${opportunityId}: status ${opportunity.status} is not on the client-decision route path — not routing further.`,
        );
        return;
      }

      const next = fullPath[index];
      try {
        await this.workflow.transition({
          entityType: 'Opportunity',
          entityId: opportunityId,
          toStatus: next,
          actorUserId,
        });
      } catch (err) {
        this.logger.warn(
          `ClientDecision for Opportunity ${opportunityId}: routing step -> ${next} did not apply: ${(err as Error).message}`,
        );
        return;
      }
    }
  }

  private toView(
    row: ClientDecision & { opportunity?: { customerId: string } },
    opportunityStatus: OpportunityStatus,
    customerId: string,
  ): ClientDecisionView {
    const route = routeFor(row.decision);
    return {
      id: row.id,
      opportunityId: row.opportunityId,
      customerId,
      decision: row.decision,
      route,
      routeLabel: routeLabel(route),
      evidenceType: row.evidenceType,
      evidenceRef: row.evidenceRef,
      notes: row.notes,
      capturedByUserId: row.capturedByUserId,
      decidedAt: row.decidedAt,
      opportunityStatus,
      routingComplete: opportunityStatus === route,
    };
  }

  private viewFromContext(row: ClientDecisionWithContext): ClientDecisionView {
    return this.toView(row, row.opportunity.status, row.opportunity.customerId);
  }

  async capture(
    dto: CaptureClientDecisionDto,
    actor: AuthenticatedUser,
  ): Promise<ClientDecisionView> {
    const opportunity = await this.loadVisibleOpportunity(
      dto.opportunityId,
      actor,
      'Opportunity not found',
    );

    // A decision is only meaningful once a recommendation has actually been
    // sent to the client. `Recommendation.sentToClientAt` is authoritative
    // (the Opportunity status can lag a #16 best-effort advance).
    const recommendation = await this.recommendations.findByOpportunityId(
      dto.opportunityId,
    );
    if (!recommendation || recommendation.sentToClientAt === null) {
      throw new UnprocessableEntityException(
        `No recommendation has been sent to the client for Opportunity ${dto.opportunityId} — there is nothing to decide on.`,
      );
    }

    const existing = await this.clientDecisions.findByOpportunityId(
      dto.opportunityId,
    );
    if (existing) {
      throw new ConflictException(
        `A client decision (${existing.decision}) has already been recorded for Opportunity ${dto.opportunityId}.`,
      );
    }

    // `evidenceRef` / `notes` are already trimmed by the DTO's
    // `@Transform(trimIfString)`; an empty `notes` normalizes to null.
    const notes = dto.notes && dto.notes.length > 0 ? dto.notes : null;

    let created: ClientDecision;
    try {
      created = await this.clientDecisions.create({
        opportunityId: dto.opportunityId,
        decision: dto.decision,
        evidenceType: dto.evidenceType,
        evidenceRef: dto.evidenceRef,
        notes,
        capturedByUserId: actor.id,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `A client decision has already been recorded for Opportunity ${dto.opportunityId}.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'ClientDecision',
      entityId: created.id,
      afterValue: clientDecisionAuditSnapshot(created),
    });

    await this.routeOpportunity(
      dto.opportunityId,
      routeFor(dto.decision),
      actor.id,
    );

    // Re-read the Opportunity so the view reports where the routing actually
    // landed.
    const after = await this.opportunities.findById(dto.opportunityId);
    return this.toView(
      created,
      after?.status ?? opportunity.status,
      opportunity.customerId,
    );
  }

  async list(
    query: ListClientDecisionsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ClientDecisionView[]> {
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
      const row = await this.clientDecisions.findByOpportunityId(
        query.opportunityId,
      );
      return row ? [this.viewFromContext(row)] : [];
    }

    await this.assertCustomerVisible(query.customerId as string, actor);
    const rows = await this.clientDecisions.findManyByCustomerId(
      query.customerId as string,
    );
    return rows.map((r) => this.viewFromContext(r));
  }

  async get(id: string, actor: AuthenticatedUser): Promise<ClientDecisionView> {
    const row = await this.clientDecisions.findById(id);
    if (!row) {
      throw new NotFoundException('Client decision not found');
    }
    try {
      await this.assertCustomerVisible(row.opportunity.customerId, actor);
    } catch {
      throw new NotFoundException('Client decision not found');
    }
    return this.viewFromContext(row);
  }
}
