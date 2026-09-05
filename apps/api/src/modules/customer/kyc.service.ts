import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { KYCRecord } from '@ibms/db';
import {
  KycRecordRepository,
  type KycRecordWithCustomer,
} from '../../repositories/kyc-record.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { ScreeningService } from './screening.service';
import { SlaTimerService } from '../sla/sla-timer.service';
import { applyDuration } from '../../common/business-days.util';
import { assertDifferentActors } from '../../common/maker-checker.util';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ScheduleReviewDto } from './dto/schedule-review.dto';
import type { ListKycRecordsQueryDto } from './dto/list-kyc-records-query.dto';

const CROSS_OWNER_ROLES = [
  'BRANCH_DEPARTMENT_MANAGER',
  'EXECUTIVE_MANAGEMENT',
  'COMPLIANCE_OFFICER',
  'EXTERNAL_AUDITOR',
] as const;

// Re-KYC cadence by risk level — DRAFT, UNSOURCED, same caveat as the SLA
// durations in sla-registry.config.ts. See
// ibms-brain/meta/lex/kyc-aml-sla-timers.md (filed via /brain-gap).
const REVIEW_CADENCE_MONTHS: Record<'STANDARD' | 'HIGH', number> = {
  STANDARD: 12,
  HIGH: 6,
};

function slaWorkflowName(
  isEdd: boolean,
): 'kyc_edd_review' | 'kyc_standard_review' {
  return isEdd ? 'kyc_edd_review' : 'kyc_standard_review';
}

/** Process 3-4 — the KYC lifecycle on top of the generic
 * WorkflowTransitionService (A.6) and SlaTimerService (A.8). Status moves
 * (never a direct field write —
 * ibms-brain/meta/lex/workflow-state-transitions.md):
 *
 * DRAFT -[submit]-> SUBMITTED -[runScreening]-> SCREENING
 *   -[triggerEdd, only if isEdd]-> EDD -[decide]-> COMPLIANCE_REVIEW -[decide]-> APPROVED|REJECTED
 *   -[decide, only if !isEdd]-> COMPLIANCE_REVIEW -[decide]-> APPROVED|REJECTED
 *
 * `decide()` folds the SCREENING/EDD -> COMPLIANCE_REVIEW step into the same
 * call as the final APPROVED/REJECTED move — COMPLIANCE_REVIEW has no
 * separate permission of its own in the seeded grid (kyc.approve covers the
 * whole decision), so there is nothing for a caller to do with an
 * intermediate stop there. Because those are two separate transitions with
 * no `$transaction` spanning them, `decide()` also *accepts* a record left
 * in the transient COMPLIANCE_REVIEW state by an interrupted earlier call
 * and resumes it, rather than dead-ending (there is no other endpoint that
 * moves a record out of COMPLIANCE_REVIEW) — and likewise resumes an
 * APPROVED record whose post-approval tail (SLA resolve, review-date write,
 * Customer activation) did not finish, so a crash there cannot strand the
 * Customer in PENDING_KYC. `runScreening()` runs the
 * watchlist check *before* the SCREENING transition for the same reason:
 * a screening failure leaves the record retriable in SUBMITTED, never
 * stranded in SCREENING with no results. */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly kycRecords: KycRecordRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
    private readonly screening: ScreeningService,
    private readonly sla: SlaTimerService,
  ) {}

  private isCrossOwner(actor: AuthenticatedUser): boolean {
    return actor.roles.some((role) =>
      (CROSS_OWNER_ROLES as readonly string[]).includes(role),
    );
  }

  async start(customerId: string, actorUserId: string): Promise<KYCRecord> {
    const customer = await this.customers.findById(customerId);
    if (!customer || customer.ownerUserId !== actorUserId) {
      throw new NotFoundException('Customer not found');
    }

    const existing = await this.kycRecords.findLatestByCustomerId(customerId);
    if (
      existing &&
      !['APPROVED', 'REJECTED', 'PERIODIC_REVIEW_DUE'].includes(existing.status)
    ) {
      throw new UnprocessableEntityException(
        `Customer ${customerId} already has an in-progress KYC file (${existing.id}, status ${existing.status}) — resolve it before starting another.`,
      );
    }

    const kyc = await this.kycRecords.create({
      customerId,
      createdByUserId: actorUserId,
    });

    await this.audit.record({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'KYCRecord',
      entityId: kyc.id,
      afterValue: { customerId, status: kyc.status },
    });

    return kyc;
  }

  private async findOwnedKyc(
    id: string,
    actorUserId: string,
  ): Promise<KYCRecord> {
    const kyc = await this.kycRecords.findById(id);
    if (!kyc || kyc.createdByUserId !== actorUserId) {
      throw new NotFoundException('KYCRecord not found');
    }
    return kyc;
  }

  /** Find-or-404, shared by every method below that needs the full row —
   * both to re-fetch after a transition (WorkflowTransitionService.transition()
   * itself only returns the narrow `{id, status}` shape, same "guard right
   * at the write, re-read after" style WorkflowTransitionService and
   * SlaTimerService already use) and as the initial lookup before checking
   * a business precondition. */
  private async mustFind(id: string): Promise<KYCRecord> {
    const kyc = await this.kycRecords.findById(id);
    if (!kyc) {
      throw new NotFoundException(`KYCRecord ${id} not found`);
    }
    return kyc;
  }

  async submit(id: string, actorUserId: string): Promise<KYCRecord> {
    await this.findOwnedKyc(id, actorUserId);
    await this.workflow.transition({
      entityType: 'KYCRecord',
      entityId: id,
      toStatus: 'SUBMITTED',
      actorUserId,
      data: { submittedAt: new Date() },
    });
    return this.mustFind(id);
  }

  /** Compliance-only (screening.run). Runs the watchlist check and moves
   * the file into SCREENING — the check runs FIRST so a failure inside it
   * leaves the record retriable in SUBMITTED (re-POST this endpoint) rather
   * than stranded in SCREENING with no results (SCREENING -> SCREENING is
   * rejected by the engine, and decide() refuses a file with no
   * ScreeningResult rows). */
  async runScreening(id: string, actorUserId: string): Promise<KYCRecord> {
    const kyc = await this.mustFind(id);
    if (kyc.status !== 'SUBMITTED') {
      throw new UnprocessableEntityException(
        `KYCRecord ${id}: run-screening applies to a SUBMITTED file (this one is ${kyc.status}). Use rerun-screening for an APPROVED file.`,
      );
    }

    const { isEdd } = await this.screening.run(id, actorUserId);

    await this.workflow.transition({
      entityType: 'KYCRecord',
      entityId: id,
      toStatus: 'SCREENING',
      actorUserId,
    });

    // Best-effort: the file is already durably in SCREENING with its
    // results — a missing escalation timer must not turn a successful
    // screening run into a reported failure (same philosophy as the
    // workflow engine's own sideEffect catch). The SLA sweep simply won't
    // have a row to escalate for this file until it is re-run.
    const workflowName = slaWorkflowName(isEdd);
    try {
      const dueAt = this.sla.computeDueAt(workflowName, new Date());
      await this.sla.startTimer({
        entityType: 'KYCRecord',
        entityId: id,
        workflowName,
        dueAt,
        actorUserId,
      });
    } catch (err) {
      this.logger.error(
        `KYCRecord ${id}: failed to start the ${workflowName} SLA timer after screening committed`,
        err as Error,
      );
    }

    return this.mustFind(id);
  }

  /** Compliance-only (kyc.edd.trigger). "Trigger the enhanced due-diligence
   * path on a high-risk result" — presupposes a result (isEdd already
   * true), not a free-form manual override with no screening signal behind
   * it. */
  async triggerEdd(id: string, actorUserId: string): Promise<KYCRecord> {
    const kyc = await this.mustFind(id);
    if (!kyc.isEdd) {
      throw new UnprocessableEntityException(
        `KYCRecord ${id}: no high-risk screening result to trigger EDD from`,
      );
    }
    await this.workflow.transition({
      entityType: 'KYCRecord',
      entityId: id,
      toStatus: 'EDD',
      actorUserId,
    });
    return this.mustFind(id);
  }

  /** Compliance-only (screening.run). "on any material change" — re-screens
   * an already-onboarded customer without reopening or re-transitioning the
   * KYC file itself; a fresh HIT surfaces via `escalatedToComplianceAt` on
   * the new ScreeningResult row (see the Compliance queue), not by forcing
   * a status move — deliberately out of scope here, see README § Known
   * gaps, Part C #3-4. Accepts PERIODIC_REVIEW_DUE as well as APPROVED: a
   * file awaiting re-KYC covers an ACTIVE customer whose ongoing
   * sanctions/PEP/AML screening must not lapse just because the periodic
   * scheduler has flagged the review (same reason the monthly batch
   * re-screens both — see screening-batch.scheduler.ts). */
  async rerunScreening(id: string, actorUserId: string) {
    const kyc = await this.mustFind(id);
    if (kyc.status !== 'APPROVED' && kyc.status !== 'PERIODIC_REVIEW_DUE') {
      throw new UnprocessableEntityException(
        `KYCRecord ${id}: can only rerun screening on an APPROVED or PERIODIC_REVIEW_DUE KYC file (this one is ${kyc.status})`,
      );
    }
    return this.screening.run(id, actorUserId);
  }

  /** Compliance-only (kyc.approve — covers both approve and reject).
   * Maker/checker: the Compliance Officer deciding must differ from the
   * Sales Officer who captured the file (maker-checker-segregation.md). */
  async decide(
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string | undefined,
    actorUserId: string,
  ): Promise<KYCRecord> {
    const kyc = await this.mustFind(id);
    assertDifferentActors(
      kyc.createdByUserId,
      actorUserId,
      'KYCRecord.approve',
    );

    if (decision === 'REJECTED' && !reason?.trim()) {
      throw new BadRequestException(
        'A KYC rejection requires a stated reason.',
      );
    }

    // Resume path: an earlier decide('APPROVED') committed the KYCRecord ->
    // APPROVED transition but crashed before finishing the tail (the SLA
    // resolve, the audit row, the nextReviewDueAt write, and — the one that
    // actually strands the record — the Customer PENDING_KYC -> ACTIVE
    // activation). APPROVED is terminal and no other endpoint moves the
    // Customer, so without this the file is APPROVED forever while the
    // Customer sits PENDING_KYC. Re-run only the idempotent tail rather than
    // dead-ending on the status guard below — same "resumable, no
    // $transaction" shape as the SCREENING/EDD -> COMPLIANCE_REVIEW span.
    // Kept narrow: a genuinely finished approval (review date written AND
    // Customer no longer PENDING_KYC) still gets the "cannot decide from
    // APPROVED" rejection.
    if (decision === 'APPROVED' && kyc.status === 'APPROVED') {
      const customer = await this.customers.findById(kyc.customerId);
      const tailUnfinished =
        kyc.nextReviewDueAt == null || customer?.status === 'PENDING_KYC';
      if (!tailUnfinished) {
        throw new UnprocessableEntityException(
          `KYCRecord ${id}: cannot record a decision from status ${kyc.status}`,
        );
      }
      await this.sla.resolve({
        entityType: 'KYCRecord',
        entityId: id,
        workflowName: slaWorkflowName(kyc.isEdd),
        actorUserId,
      });
      await this.finalizeApproval(kyc, actorUserId);
      await this.audit.record({
        userId: actorUserId,
        action: 'APPROVE',
        entityType: 'KYCRecord',
        entityId: id,
        afterValue: { reason, resumed: true },
      });
      return this.mustFind(id);
    }

    if (kyc.status === 'SCREENING' && kyc.isEdd) {
      throw new UnprocessableEntityException(
        `KYCRecord ${id}: a high-risk result must go through the EDD path first (POST /kyc-records/${id}/trigger-edd) before a decision can be recorded.`,
      );
    }
    // COMPLIANCE_REVIEW is accepted too: it is a transient state with no
    // resting endpoint of its own, so a record left there by an earlier
    // decide() call that failed between its two transitions must be
    // resumable, not dead-ended.
    if (
      kyc.status !== 'SCREENING' &&
      kyc.status !== 'EDD' &&
      kyc.status !== 'COMPLIANCE_REVIEW'
    ) {
      throw new UnprocessableEntityException(
        `KYCRecord ${id}: cannot record a decision from status ${kyc.status}`,
      );
    }

    // A decision is only meaningful once screening has actually run. A file
    // stranded in SCREENING by an interrupted runScreening() has no
    // ScreeningResult rows — approving it would activate a Customer with no
    // sanctions/PEP/AML check ever performed.
    const screeningResults =
      await this.kycRecords.findScreeningResultsByKycRecordId(id);
    if (screeningResults.length === 0) {
      throw new UnprocessableEntityException(
        `KYCRecord ${id}: screening has not completed — run POST /kyc-records/${id}/run-screening first.`,
      );
    }

    if (kyc.status !== 'COMPLIANCE_REVIEW') {
      await this.workflow.transition({
        entityType: 'KYCRecord',
        entityId: id,
        toStatus: 'COMPLIANCE_REVIEW',
        actorUserId,
      });
    }

    await this.workflow.transition({
      entityType: 'KYCRecord',
      entityId: id,
      toStatus: decision,
      actorUserId,
      data:
        decision === 'APPROVED'
          ? { approvedByUserId: actorUserId, approvedAt: new Date() }
          : undefined,
    });

    await this.sla.resolve({
      entityType: 'KYCRecord',
      entityId: id,
      workflowName: slaWorkflowName(kyc.isEdd),
      actorUserId,
    });

    await this.audit.record({
      userId: actorUserId,
      action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
      entityType: 'KYCRecord',
      entityId: id,
      afterValue: { reason },
    });

    if (decision === 'APPROVED') {
      await this.finalizeApproval(kyc, actorUserId);
    }

    return this.mustFind(id);
  }

  /** The post-APPROVED tail: set the risk-based re-KYC date, then activate
   * the Customer. Idempotent by construction — the date is recomputed and
   * overwritten, and the activation is guarded on `PENDING_KYC` — so
   * `decide()` can re-run it to finish an approval that crashed partway
   * (see the resume branch above) without double-applying anything. */
  private async finalizeApproval(
    kyc: KYCRecord,
    actorUserId: string,
  ): Promise<void> {
    const riskRating = await this.kycRecords.findRiskRatingByKycRecordId(
      kyc.id,
    );
    const cadenceMonths =
      REVIEW_CADENCE_MONTHS[riskRating?.level ?? 'STANDARD'];
    const nextReviewDueAt = applyDuration(new Date(), {
      value: cadenceMonths,
      unit: 'months',
    });
    await this.kycRecords.update(kyc.id, { nextReviewDueAt });

    // Only PENDING_KYC -> ACTIVE is a legal Customer move (see
    // WORKFLOW_TRANSITIONS.Customer) — the first-ever approval finds the
    // Customer PENDING_KYC and activates it, but a periodic re-KYC
    // approval (KycPeriodicReviewScheduler moves an APPROVED KYCRecord to
    // PERIODIC_REVIEW_DUE, then a fresh KYCRecord is started and decided
    // on an already-ACTIVE Customer — see kyc.service.spec.ts) finds it
    // already ACTIVE. The status guard covers the sequential case; the
    // try/catch covers the concurrent one — two KYC files for the same
    // Customer approved at once both read PENDING_KYC here, and the loser
    // of the `updateMany` race would otherwise get a thrown
    // ConflictException *after* its own KYCRecord already committed
    // APPROVED. The Customer reaching ACTIVE is the goal; that another
    // approval got there first is not this call's failure.
    const customer = await this.customers.findById(kyc.customerId);
    if (customer?.status === 'PENDING_KYC') {
      try {
        await this.workflow.transition({
          entityType: 'Customer',
          entityId: kyc.customerId,
          toStatus: 'ACTIVE',
          actorUserId,
        });
      } catch (err) {
        const after = await this.customers.findById(kyc.customerId);
        if (after?.status === 'PENDING_KYC') {
          throw err; // genuinely not activated — surface it
        }
        this.logger.warn(
          `KYCRecord ${kyc.id}: Customer ${kyc.customerId} was activated concurrently by another approval — nothing to do.`,
        );
      }
    }
  }

  /** Compliance-only (kyc.review.schedule). Manual override of the
   * risk-based default `decide()` already set at approval time. */
  async scheduleReview(
    id: string,
    dto: ScheduleReviewDto,
    actorUserId: string,
  ): Promise<KYCRecord> {
    const kyc = await this.mustFind(id);
    if (kyc.status !== 'APPROVED') {
      throw new UnprocessableEntityException(
        `KYCRecord ${id}: can only schedule a review for an APPROVED KYC file (this one is ${kyc.status})`,
      );
    }

    let nextReviewDueAt: Date;
    if (dto.nextReviewDueAt) {
      nextReviewDueAt = new Date(dto.nextReviewDueAt);
      // @IsISO8601() (schedule-review.dto.ts) only validates the format —
      // a well-formed but past date would otherwise be picked up by
      // KycPeriodicReviewScheduler's very next daily sweep regardless of
      // the customer's actual risk-based cadence.
      if (nextReviewDueAt.getTime() <= Date.now()) {
        throw new BadRequestException('nextReviewDueAt must be in the future.');
      }
    } else {
      const riskRating = await this.kycRecords.findRiskRatingByKycRecordId(id);
      const cadenceMonths =
        REVIEW_CADENCE_MONTHS[riskRating?.level ?? 'STANDARD'];
      nextReviewDueAt = applyDuration(new Date(), {
        value: cadenceMonths,
        unit: 'months',
      });
    }

    const updated = await this.kycRecords.update(id, { nextReviewDueAt });
    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'KYCRecord',
      entityId: id,
      afterValue: { nextReviewDueAt: nextReviewDueAt.toISOString() },
    });
    return updated;
  }

  async get(id: string, actor: AuthenticatedUser): Promise<KYCRecord> {
    const kyc = await this.kycRecords.findById(id);
    if (!kyc) throw new NotFoundException('KYCRecord not found');
    if (this.isCrossOwner(actor)) return kyc;
    if (kyc.createdByUserId === actor.id) return kyc;
    throw new NotFoundException('KYCRecord not found');
  }

  list(
    query: ListKycRecordsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<KycRecordWithCustomer[]> {
    return this.kycRecords.findMany({
      status: query.status,
      customerId: query.customerId,
      customerOwnerUserId: this.isCrossOwner(actor) ? undefined : actor.id,
    });
  }
}
