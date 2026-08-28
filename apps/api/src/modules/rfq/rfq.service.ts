import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { OpportunityStatus } from '@ibms/db';
import {
  RfqRepository,
  type RfqInsurerWithParents,
  type RfqWithSubmissions,
  type SelectableInsurer,
} from '../../repositories/rfq.repository';
import { OpportunityRepository } from '../../repositories/opportunity.repository';
import { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { CUSTOMER_FILE_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import { isFollowUpDue } from './rfq.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateRfqDto } from './dto/create-rfq.dto';
import type { AddRfqInsurersDto } from './dto/add-rfq-insurers.dto';
import type { TransitionRfqInsurerDto } from './dto/transition-rfq-insurer.dto';
import type { ListRfqsQueryDto } from './dto/list-rfqs-query.dto';

/** Result of one follow-up sweep run — logged by the scheduler. */
export interface FollowUpScanResult {
  /** Not-yet-alerted submissions still awaiting a response. */
  candidates: number;
  /** Of those, how many cleared the business-day threshold this run. */
  due: number;
  /** Of the due ones, how many this run actually stamped (a concurrent
   * sweep may have stamped some first — `stampFollowUpAlert` returns 0). */
  alerted: number;
  /** Rows that threw and were skipped — the next run retries them. */
  failed: number;
}

const P2002 = 'P2002';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
  );
}

/**
 * Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B).
 *
 *  - `createRfq` — one RFQ per insurance line under an Opportunity, sent to a
 *    shortlist of insurers (each a SENT `RFQInsurer` row). One RFQ per
 *    `(opportunity, insuranceLine)` is a real DB invariant
 *    (`@@unique`, ibms-brain/meta/lex/race-safe-invariants.md); the first
 *    RFQ moves the Opportunity NEEDS_CONFIRMED -> RFQ_ISSUED via
 *    WorkflowTransitionService (A.6).
 *  - `addInsurers` — broaden a shortlist later (skips insurers already on it,
 *    the `@@unique([rfqId, insurerId])` being the backstop).
 *  - `transitionInsurer` — record an insurer's response status
 *    (viewed/quoted/declined/no-response) through the workflow engine;
 *    QUOTED / DECLINED stamp `respondedAt`.
 *  - `runFollowUpScan` — the nightly sweep: stamps `followUpAlertSentAt` +
 *    writes an audit row on every still-open submission past its RFQ's
 *    business-day `followUpThresholdDays`. **Alert only** — it does NOT move
 *    a silent insurer to NO_RESPONSE; that is a human decision in Process 12.
 *
 * No maker/checker: issuing an RFQ and recording insurer responses is
 * single-actor Placement work, and the coverage set was maker/checker-
 * approved at the Needs Assessment stage (A.5).
 *
 * Visibility mirrors InsuranceProgramService / OpportunityService: an RFQ
 * inherits its Opportunity's Customer's visibility — the owning
 * Sales/Relationship Officer, or a CUSTOMER_FILE_CROSS_OWNER_ROLES holder
 * (Placement/Manager/Executive) working the whole book.
 */
@Injectable()
export class RfqService {
  private readonly logger = new Logger(RfqService.name);

  constructor(
    private readonly rfqs: RfqRepository,
    private readonly opportunities: OpportunityRepository,
    private readonly programs: InsuranceProgramRepository,
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
        `RFQ audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** NotFoundException whether the customer is missing or just not visible —
   * no existence oracle (same pattern as OpportunityService). */
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
   * given label. */
  private async assertOpportunityVisible(
    opportunityId: string,
    actor: AuthenticatedUser,
    label: string,
  ): Promise<{
    id: string;
    customerId: string;
    status: OpportunityStatus;
    insuranceProgramId: string | null;
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
      insuranceProgramId: opportunity.insuranceProgramId,
    };
  }

  /** An RFQ can only be worked (shortlist broadened, responses recorded)
   * while its Opportunity is still in the market phase. Modelled ahead of
   * #16-17, which add the CLOSED_LOST / PLACEMENT moves that make this
   * meaningful. */
  private assertOpportunityInMarketPhase(status: OpportunityStatus): void {
    if (status !== 'NEEDS_CONFIRMED' && status !== 'RFQ_ISSUED') {
      throw new UnprocessableEntityException(
        `The parent Opportunity is ${status}; its RFQs can no longer be changed.`,
      );
    }
  }

  private async findVisibleRfq(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{
    rfq: RfqWithSubmissions;
    opportunityStatus: OpportunityStatus;
  }> {
    const rfq = await this.rfqs.findRfqById(id);
    if (!rfq) {
      throw new NotFoundException('RFQ not found');
    }
    const opportunity = await this.assertOpportunityVisible(
      rfq.opportunityId,
      actor,
      'RFQ not found',
    );
    return { rfq, opportunityStatus: opportunity.status };
  }

  private async mustFindRfq(id: string): Promise<RfqWithSubmissions> {
    const rfq = await this.rfqs.findRfqById(id);
    if (!rfq) {
      throw new NotFoundException(`RFQ ${id} not found`);
    }
    return rfq;
  }

  private async assertInsurersExist(insurerIds: string[]): Promise<void> {
    if (insurerIds.length === 0) {
      throw new UnprocessableEntityException(
        'Select at least one insurer for the shortlist.',
      );
    }
    const known = await this.rfqs.countInsurersByIds(insurerIds);
    if (known !== insurerIds.length) {
      throw new UnprocessableEntityException(
        'One or more shortlisted insurers do not exist.',
      );
    }
  }

  /** The RFQ line must be one of the canonical `insuranceLine` strings on the
   * designed Insurance Program (Process 7) the Opportunity was taken to
   * market from — a typo or an off-programme line would otherwise seed a
   * first-class RFQ that #13 (Quotation) / #14 (Comparison) / #16
   * (Recommendation) all key off. Skipped only when the Opportunity has no
   * programme (not reachable in this backlog item — `POST /opportunities`
   * always sets one — but modelled ahead of new-business Opportunities). */
  private async assertLineInProgramme(
    insuranceProgramId: string | null,
    insuranceLine: string,
  ): Promise<void> {
    if (!insuranceProgramId) return;
    const programme = await this.programs.findById(insuranceProgramId);
    if (!programme) return;
    const lines = programme.lines.map((l) => l.insuranceLine);
    if (!lines.includes(insuranceLine)) {
      throw new UnprocessableEntityException(
        `"${insuranceLine}" is not a line on this Opportunity's Insurance Program. Designed lines: ${lines.join(', ') || '(none)'}.`,
      );
    }
  }

  /** Inserts the RFQ row, mapping the `@@unique([opportunityId,
   * insuranceLine])` violation (a concurrent createRfq for the same line
   * lost the race) to the same 409 the pre-check raises. */
  private async insertRfqRow(
    dto: CreateRfqDto,
    actorId: string,
  ): Promise<RfqWithSubmissions> {
    try {
      const created = await this.rfqs.createRfq({
        opportunityId: dto.opportunityId,
        insuranceLine: dto.insuranceLine,
        followUpThresholdDays: dto.followUpThresholdDays,
        issuedByUserId: actorId,
      });
      return await this.mustFindRfq(created.id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Opportunity ${dto.opportunityId} already has an RFQ for "${dto.insuranceLine}" — add insurers to it instead of creating another.`,
        );
      }
      throw err;
    }
  }

  /** Best-effort NEEDS_CONFIRMED -> RFQ_ISSUED on the first RFQ. The RFQ is
   * already committed + audited by the time this runs, so a concurrent
   * create() that moved the Opportunity first (ConflictException), or any
   * other transition hiccup (including a swallowed audit-write failure inside
   * transition()), is logged — never surfaced as a failure of the RFQ
   * creation (same philosophy as WorkflowTransitionService's own sideEffect
   * catch).
   *
   * Consequence for Process 12+: `Opportunity.status` is NOT a reliable "has
   * RFQs" signal — an RFQ can exist while its Opportunity is still
   * NEEDS_CONFIRMED (this move lost a race or hit a transient error). Derive
   * "the Opportunity has been to market" from the RFQ table, not the status
   * column. The next createRfq for another line retries this move. */
  private async markOpportunityRfqIssued(
    opportunityId: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.workflow.transition({
        entityType: 'Opportunity',
        entityId: opportunityId,
        toStatus: 'RFQ_ISSUED',
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `RFQ issued for Opportunity ${opportunityId} but the NEEDS_CONFIRMED -> RFQ_ISSUED transition did not apply: ${(err as Error).message}`,
      );
    }
  }

  async createRfq(
    dto: CreateRfqDto,
    actor: AuthenticatedUser,
  ): Promise<RfqWithSubmissions> {
    const opportunity = await this.assertOpportunityVisible(
      dto.opportunityId,
      actor,
      'Opportunity not found',
    );

    if (
      opportunity.status !== 'NEEDS_CONFIRMED' &&
      opportunity.status !== 'RFQ_ISSUED'
    ) {
      throw new UnprocessableEntityException(
        `Opportunity ${opportunity.id} is ${opportunity.status}; an RFQ can only be issued while it is NEEDS_CONFIRMED or RFQ_ISSUED.`,
      );
    }

    await this.assertLineInProgramme(
      opportunity.insuranceProgramId,
      dto.insuranceLine,
    );

    const insurerIds = [...new Set(dto.insurerIds)];
    await this.assertInsurersExist(insurerIds);

    // The `@@unique([opportunityId, insuranceLine])` is the real enforcement
    // — insertRfqRow() maps its violation to 409. This pre-check is the fast
    // path: a descriptive 409 naming the existing RFQ when there is no race.
    const existing = await this.rfqs.findRfqByOpportunityAndLine(
      dto.opportunityId,
      dto.insuranceLine,
    );
    if (existing) {
      throw new ConflictException(
        `Opportunity ${dto.opportunityId} already has an RFQ for "${dto.insuranceLine}" (${existing.id}) — add insurers to it instead.`,
      );
    }

    const rfq = await this.insertRfqRow(dto, actor.id);

    // Audit CREATE BEFORE the shortlist insert: a crash in between still
    // leaves a CREATE trail, and the resulting zero-insurer RFQ is
    // recoverable via addInsurers() (same ordering as
    // InsuranceProgramService.assemble).
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'RFQ',
      entityId: rfq.id,
      afterValue: {
        opportunityId: dto.opportunityId,
        insuranceLine: dto.insuranceLine,
        followUpThresholdDays: rfq.followUpThresholdDays,
        shortlistInsurerIds: insurerIds,
      },
    });

    for (const insurerId of insurerIds) {
      try {
        await this.rfqs.createInsurerSubmission(rfq.id, insurerId);
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }

    if (opportunity.status === 'NEEDS_CONFIRMED') {
      await this.markOpportunityRfqIssued(opportunity.id, actor.id);
    }

    return this.mustFindRfq(rfq.id);
  }

  async addInsurers(
    rfqId: string,
    dto: AddRfqInsurersDto,
    actor: AuthenticatedUser,
  ): Promise<RfqWithSubmissions> {
    const { opportunityStatus } = await this.findVisibleRfq(rfqId, actor);
    this.assertOpportunityInMarketPhase(opportunityStatus);

    const insurerIds = [...new Set(dto.insurerIds)];
    await this.assertInsurersExist(insurerIds);

    const alreadyOn = new Set(
      await this.rfqs.findExistingShortlistInsurerIds(rfqId, insurerIds),
    );
    const added: string[] = [];
    for (const insurerId of insurerIds) {
      if (alreadyOn.has(insurerId)) continue;
      try {
        await this.rfqs.createInsurerSubmission(rfqId, insurerId);
        added.push(insurerId);
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }

    if (added.length > 0) {
      await this.safeAudit({
        userId: actor.id,
        action: 'UPDATE',
        entityType: 'RFQ',
        entityId: rfqId,
        afterValue: { addedShortlistInsurerIds: added },
      });
    }

    return this.mustFindRfq(rfqId);
  }

  async transitionInsurer(
    submissionId: string,
    dto: TransitionRfqInsurerDto,
    actor: AuthenticatedUser,
  ): Promise<RfqInsurerWithParents> {
    const submission = await this.rfqs.findInsurerSubmissionById(submissionId);
    if (!submission) {
      throw new NotFoundException('RFQ submission not found');
    }
    try {
      await this.assertCustomerVisible(
        submission.rfq.opportunity.customerId,
        actor,
      );
    } catch {
      throw new NotFoundException('RFQ submission not found');
    }

    // Deliberately NOT gated on the Opportunity's market phase (unlike
    // createRfq / addInsurers): recording what an insurer actually did is a
    // factual log — a late QUOTED or DECLINED that lands after the business
    // was placed elsewhere is still worth capturing. The workflow engine's
    // own legal-move map (WORKFLOW_TRANSITIONS.RFQInsurer) is the only gate.

    // A terminal response stamps respondedAt alongside the status, in the
    // same write; VIEWED / NO_RESPONSE do not (an insurer can still respond
    // after either).
    const data =
      dto.toStatus === 'QUOTED' || dto.toStatus === 'DECLINED'
        ? { respondedAt: new Date() }
        : undefined;

    await this.workflow.transition({
      entityType: 'RFQInsurer',
      entityId: submissionId,
      toStatus: dto.toStatus,
      actorUserId: actor.id,
      data,
    });

    const updated = await this.rfqs.findInsurerSubmissionById(submissionId);
    if (!updated) {
      throw new NotFoundException('RFQ submission not found');
    }
    return updated;
  }

  async list(
    query: ListRfqsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<RfqWithSubmissions[]> {
    const { opportunityId, customerId } = query;
    if ((opportunityId && customerId) || (!opportunityId && !customerId)) {
      throw new UnprocessableEntityException(
        'Provide exactly one of opportunityId or customerId.',
      );
    }
    if (opportunityId) {
      await this.assertOpportunityVisible(
        opportunityId,
        actor,
        'Opportunity not found',
      );
      return this.rfqs.findRfqsByOpportunityId(opportunityId);
    }
    await this.assertCustomerVisible(customerId as string, actor);
    return this.rfqs.findRfqsByCustomerId(customerId as string);
  }

  async get(id: string, actor: AuthenticatedUser): Promise<RfqWithSubmissions> {
    const { rfq } = await this.findVisibleRfq(id, actor);
    return rfq;
  }

  listSelectableInsurers(): Promise<SelectableInsurer[]> {
    return this.rfqs.findSelectableInsurers();
  }

  /**
   * The nightly follow-up sweep (also runnable on demand from a test). For
   * each not-yet-alerted submission still awaiting a response whose RFQ's
   * business-day `followUpThresholdDays` has elapsed since `sentAt`: stamp
   * `followUpAlertSentAt` (race-safe — `stampFollowUpAlert` is conditional on
   * it still being null) and write an audit row. Per-row isolation so one
   * bad row does not abandon the rest of the run (same shape as
   * CrossSellDetectionScheduler).
   */
  async runFollowUpScan(actorUserId: string): Promise<FollowUpScanResult> {
    const now = new Date();
    const candidates = await this.rfqs.findOpenSubmissionsForFollowUp();

    let due = 0;
    let alerted = 0;
    let failed = 0;

    for (const submission of candidates) {
      if (
        !isFollowUpDue(
          submission.sentAt,
          submission.rfq.followUpThresholdDays,
          now,
        )
      ) {
        continue;
      }
      due += 1;
      try {
        const stamped = await this.rfqs.stampFollowUpAlert(submission.id, now);
        if (stamped === 1) {
          alerted += 1;
          await this.safeAudit({
            userId: actorUserId,
            action: 'UPDATE',
            entityType: 'RFQInsurer',
            entityId: submission.id,
            afterValue: {
              followUpAlert: true,
              rfqId: submission.rfqId,
              insurerId: submission.insurerId,
              followUpThresholdDays: submission.rfq.followUpThresholdDays,
              sentAt: submission.sentAt.toISOString(),
            },
          });
        }
      } catch (err) {
        failed += 1;
        this.logger.error(
          `RFQ follow-up sweep: submission ${submission.id} failed (${(err as Error).message}) — continuing; next run will retry.`,
        );
      }
    }

    return { candidates: candidates.length, due, alerted, failed };
  }
}
