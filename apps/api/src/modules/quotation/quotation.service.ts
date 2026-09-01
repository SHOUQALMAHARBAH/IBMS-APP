import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { OpportunityStatus, Quotation, RfqInsurerStatus } from '@ibms/db';
import {
  QuotationRepository,
  type QuotationWithContext,
} from '../../repositories/quotation.repository';
import {
  RfqRepository,
  type RfqWithSubmissions,
} from '../../repositories/rfq.repository';
import { OpportunityRepository } from '../../repositories/opportunity.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { CUSTOMER_FILE_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import {
  normalizeQuotationTerms,
  quotationAuditSnapshot,
} from './quotation.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CaptureQuotationDto } from './dto/capture-quotation.dto';
import type { ReviseQuotationDto } from './dto/revise-quotation.dto';
import type { ListQuotationsQueryDto } from './dto/list-quotations-query.dto';

/** One insurer's full quotation history on one RFQ line — the shape every
 * quotation read returns. `current` is the live version (`isCurrentVersion`);
 * `versions` is the whole chain, oldest first, never pruned. */
export interface QuotationChainView {
  rfqId: string;
  insurerId: string;
  insuranceLine: string;
  insurer: QuotationWithContext['insurer'];
  current: QuotationWithContext;
  versions: QuotationWithContext[];
}

const P2002 = 'P2002';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
  );
}

/** RFQInsurer statuses a captured quote can legally advance *from* to
 * QUOTED (per WORKFLOW_TRANSITIONS.RFQInsurer). DECLINED is terminal and
 * blocked earlier; QUOTED means a current quotation already exists (409). */
const QUOTABLE_FROM: readonly RfqInsurerStatus[] = [
  'SENT',
  'VIEWED',
  'NO_RESPONSE',
];

/**
 * Process 13 — Quotation Management (backlog Part C #13, Domain B).
 *
 *  - `capture` — record an insurer's quote against one RFQ line as a
 *    version-1 `Quotation` (premium / deductible / limits / BI period /
 *    liability limit / exclusions / conditions, every monetary field
 *    fils-quantized through money.util.ts). The insurer must be on the
 *    RFQ's shortlist and must not already have a current quotation
 *    (`race-safe-invariants.md` — the PARTIAL UNIQUE index on
 *    `(rfqId, insurerId) WHERE isCurrentVersion` is the real guard, mapped
 *    to a 409 here).
 *  - `revise` — a renegotiation round: a NEW version row linked to its
 *    predecessor by `previousVersionId`, with the old row kept verbatim
 *    (`isCurrentVersion` flipped to false). Never an overwrite (Part 4.1,
 *    Part 3.3 Controls: "full version history retained for every
 *    quotation"). The predecessor-clear + successor-insert run in ONE
 *    `reviseChain` transaction (`quotation.repository.ts`); concurrency is
 *    held by two DB constraints — the PARTIAL UNIQUE (≤1 current per chain)
 *    and `previousVersionId`'s own `@unique` (≤1 successor per node) — plus
 *    the status-conditional clear inside that transaction.
 *  - `list` / `get` — quotations grouped into per-insurer chains, scoped to
 *    exactly one of `rfqId` / `opportunityId` / `customerId`.
 *
 * On a successful capture / revise the service also **best-effort** advances
 * workflow state (logged, never thrown — the quotation is already committed
 * and audited, same philosophy as `RfqService.markOpportunityRfqIssued`):
 * the matching `RFQInsurer` submission -> QUOTED (stamping `respondedAt`),
 * and the parent `Opportunity` RFQ_ISSUED -> QUOTES_RECEIVED. Neither is
 * authoritative — derive "this insurer has quoted" from the `Quotation`
 * table, not from `RFQInsurer.status`.
 *
 * `Quotation` is NOT a `WorkflowTransitionService` entity (no `status`
 * column) and has no maker/checker — capturing what an insurer sent is a
 * factual, single-actor Placement record. Visibility mirrors
 * `RfqService`: a quotation inherits its RFQ's Opportunity's Customer's
 * visibility (the owning Sales/Relationship Officer, or a
 * `CUSTOMER_FILE_CROSS_OWNER_ROLES` holder working the whole book).
 */
@Injectable()
export class QuotationService {
  private readonly logger = new Logger(QuotationService.name);

  constructor(
    private readonly quotations: QuotationRepository,
    private readonly rfqs: RfqRepository,
    private readonly opportunities: OpportunityRepository,
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
        `Quotation audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** NotFoundException whether the customer is missing or just not visible —
   * no existence oracle (same pattern as RfqService / OpportunityService). */
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

  /** Loads an RFQ and enforces the caller's visibility on its Opportunity's
   * Customer; every failure mode collapses to one NotFoundException with the
   * given label. */
  private async loadVisibleRfq(
    rfqId: string,
    actor: AuthenticatedUser,
    label: string,
  ): Promise<{
    rfq: RfqWithSubmissions;
    opportunityId: string;
    opportunityStatus: OpportunityStatus;
    customerId: string;
  }> {
    const rfq = await this.rfqs.findRfqById(rfqId);
    if (!rfq) {
      throw new NotFoundException(label);
    }
    const opportunity = await this.opportunities.findById(rfq.opportunityId);
    if (!opportunity) {
      throw new NotFoundException(label);
    }
    try {
      await this.assertCustomerVisible(opportunity.customerId, actor);
    } catch {
      throw new NotFoundException(label);
    }
    return {
      rfq,
      opportunityId: opportunity.id,
      opportunityStatus: opportunity.status,
      customerId: opportunity.customerId,
    };
  }

  /** Best-effort RFQInsurer -> QUOTED on the shortlisted insurer that just
   * quoted. Logged, never thrown. */
  private async advanceInsurerToQuoted(
    submissionId: string,
    currentStatus: RfqInsurerStatus,
    actorUserId: string,
  ): Promise<void> {
    if (!QUOTABLE_FROM.includes(currentStatus)) return;
    try {
      await this.workflow.transition({
        entityType: 'RFQInsurer',
        entityId: submissionId,
        toStatus: 'QUOTED',
        actorUserId,
        data: { respondedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        `Quotation captured on RFQInsurer ${submissionId} but the -> QUOTED transition did not apply: ${(err as Error).message}`,
      );
    }
  }

  /** Best-effort Opportunity RFQ_ISSUED -> QUOTES_RECEIVED on the first
   * quote in. Logged, never thrown. */
  private async advanceOpportunityToQuotesReceived(
    opportunityId: string,
    currentStatus: OpportunityStatus,
    actorUserId: string,
  ): Promise<void> {
    if (currentStatus !== 'RFQ_ISSUED') return;
    try {
      await this.workflow.transition({
        entityType: 'Opportunity',
        entityId: opportunityId,
        toStatus: 'QUOTES_RECEIVED',
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `Quotation captured for Opportunity ${opportunityId} but the RFQ_ISSUED -> QUOTES_RECEIVED transition did not apply: ${(err as Error).message}`,
      );
    }
  }

  private groupIntoChains(rows: QuotationWithContext[]): QuotationChainView[] {
    const byChain = new Map<string, QuotationWithContext[]>();
    for (const row of rows) {
      const key = `${row.rfqId}::${row.insurerId}`;
      const list = byChain.get(key);
      if (list) list.push(row);
      else byChain.set(key, [row]);
    }
    const views: QuotationChainView[] = [];
    for (const versions of byChain.values()) {
      const ordered = [...versions].sort(
        (a, b) => a.versionNumber - b.versionNumber,
      );
      const head = ordered[ordered.length - 1];
      views.push({
        rfqId: head.rfqId,
        insurerId: head.insurerId,
        insuranceLine: head.rfq.insuranceLine,
        insurer: head.insurer,
        current: ordered.find((v) => v.isCurrentVersion) ?? head,
        versions: ordered,
      });
    }
    return views;
  }

  private async chainView(
    rfqId: string,
    insurerId: string,
  ): Promise<QuotationChainView> {
    const rows = (await this.quotations.findManyByRfqId(rfqId)).filter(
      (r) => r.insurerId === insurerId,
    );
    const [view] = this.groupIntoChains(rows);
    if (!view) {
      // Only reachable if the chain was deleted between the write and this
      // read — Quotation has no hard-delete path, so treat as a bug.
      throw new NotFoundException(
        'Quotation not found immediately after write',
      );
    }
    return view;
  }

  async capture(
    dto: CaptureQuotationDto,
    actor: AuthenticatedUser,
  ): Promise<QuotationChainView> {
    const { rfq, opportunityId, opportunityStatus } = await this.loadVisibleRfq(
      dto.rfqId,
      actor,
      'RFQ not found',
    );

    // Deliberately NOT gated on the parent Opportunity's market phase
    // (unlike RfqService.addInsurers). Recording a premium an insurer
    // actually quoted is a factual event — a late quote landing after the
    // business was placed elsewhere, or on a RENEGOTIATE / re-marketed
    // Opportunity, is still worth capturing (same reasoning RfqService
    // applies to transitionInsurer / logCommunication). The shortlist
    // membership + non-DECLINED checks below are the only gates.
    const submission = rfq.insurerSubmissions.find(
      (s) => s.insurerId === dto.insurerId,
    );
    if (!submission) {
      throw new UnprocessableEntityException(
        `Insurer ${dto.insurerId} is not on RFQ ${dto.rfqId}'s shortlist — add it to the shortlist before capturing a quote.`,
      );
    }
    if (submission.status === 'DECLINED') {
      throw new UnprocessableEntityException(
        `Insurer ${dto.insurerId} has DECLINED RFQ ${dto.rfqId} — record a fresh RFQ submission before capturing a quote from them.`,
      );
    }

    const terms = normalizeQuotationTerms(dto);

    let created: Quotation;
    try {
      created = await this.quotations.createInitial({
        rfqId: dto.rfqId,
        insurerId: dto.insurerId,
        capturedByUserId: actor.id,
        ...terms,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Insurer ${dto.insurerId} already has a current quotation on RFQ ${dto.rfqId} — revise it (POST /quotations/:id/revise) instead of capturing a new one.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Quotation',
      entityId: created.id,
      afterValue: quotationAuditSnapshot(created),
    });

    await this.advanceInsurerToQuoted(
      submission.id,
      submission.status,
      actor.id,
    );
    await this.advanceOpportunityToQuotesReceived(
      opportunityId,
      opportunityStatus,
      actor.id,
    );

    return this.chainView(dto.rfqId, dto.insurerId);
  }

  async revise(
    id: string,
    dto: ReviseQuotationDto,
    actor: AuthenticatedUser,
  ): Promise<QuotationChainView> {
    const current = await this.quotations.findById(id);
    if (!current) {
      throw new NotFoundException('Quotation not found');
    }
    const { rfq, opportunityId, opportunityStatus } = await this.loadVisibleRfq(
      current.rfqId,
      actor,
      'Quotation not found',
    );

    if (!current.isCurrentVersion) {
      throw new UnprocessableEntityException(
        `Quotation ${id} is version ${current.versionNumber}, which has been superseded — revise the current version of this chain instead.`,
      );
    }

    const terms = normalizeQuotationTerms(dto);

    // Clear the predecessor's flag + insert the successor as current in ONE
    // transaction (`reviseChain`): a `null` return means the conditional
    // clear matched nothing (a concurrent revise won the race) and the
    // transaction rolled back; a `P2002` means the successor insert lost the
    // race on the PARTIAL UNIQUE / `previousVersionId @unique` and the
    // transaction rolled back. Either way the chain is never left headless —
    // no repair step needed.
    let next: Quotation | null;
    try {
      next = await this.quotations.reviseChain({
        currentId: current.id,
        rfqId: current.rfqId,
        insurerId: current.insurerId,
        versionNumber: current.versionNumber + 1,
        capturedByUserId: actor.id,
        ...terms,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Quotation ${id} has already been revised — reload the chain and revise its new current version.`,
        );
      }
      throw err;
    }
    if (next === null) {
      throw new ConflictException(
        `Quotation ${id} was revised concurrently — reload and revise the new current version.`,
      );
    }

    const promoted = (await this.quotations.findById(next.id)) ?? next;
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Quotation',
      entityId: next.id,
      afterValue: quotationAuditSnapshot(promoted),
    });

    const submission = rfq.insurerSubmissions.find(
      (s) => s.insurerId === current.insurerId,
    );
    if (submission) {
      await this.advanceInsurerToQuoted(
        submission.id,
        submission.status,
        actor.id,
      );
    }
    await this.advanceOpportunityToQuotesReceived(
      opportunityId,
      opportunityStatus,
      actor.id,
    );

    return this.chainView(current.rfqId, current.insurerId);
  }

  async list(
    query: ListQuotationsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<QuotationChainView[]> {
    const scopes = [query.rfqId, query.opportunityId, query.customerId].filter(
      (v) => v != null,
    );
    if (scopes.length !== 1) {
      throw new UnprocessableEntityException(
        'Provide exactly one of rfqId, opportunityId or customerId.',
      );
    }

    if (query.rfqId) {
      await this.loadVisibleRfq(query.rfqId, actor, 'RFQ not found');
      return this.groupIntoChains(
        await this.quotations.findManyByRfqId(query.rfqId),
      );
    }
    if (query.opportunityId) {
      const opportunity = await this.opportunities.findById(
        query.opportunityId,
      );
      if (!opportunity) {
        throw new NotFoundException('Opportunity not found');
      }
      try {
        await this.assertCustomerVisible(opportunity.customerId, actor);
      } catch {
        throw new NotFoundException('Opportunity not found');
      }
      return this.groupIntoChains(
        await this.quotations.findManyByOpportunityId(query.opportunityId),
      );
    }
    await this.assertCustomerVisible(query.customerId as string, actor);
    return this.groupIntoChains(
      await this.quotations.findManyByCustomerId(query.customerId as string),
    );
  }

  async get(id: string, actor: AuthenticatedUser): Promise<QuotationChainView> {
    const row = await this.quotations.findById(id);
    if (!row) {
      throw new NotFoundException('Quotation not found');
    }
    await this.loadVisibleRfq(row.rfqId, actor, 'Quotation not found');
    return this.chainView(row.rfqId, row.insurerId);
  }
}
