import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { SlaTimerService } from '../sla/sla-timer.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { assertDifferentActors } from '../../common/maker-checker.util';
import { ComplaintRepository } from '../../repositories/complaint.repository';
import type { ComplaintWithDetail } from '../../repositories/complaint.repository';
import {
  complaintActionAuditSnapshot,
  complaintAuditSnapshot,
  complaintUpdateAuditSnapshot,
  COMPLAINT_READ_LIMIT,
  COMPLAINT_SLA_WORKFLOW,
  DEFAULT_ESCALATION_TARGET,
  deriveComplaintView,
  escalationAuditSnapshot,
  isTerminalComplaintStatus,
  type ComplaintView,
} from './complaint.config';
import type { CreateComplaintDto } from './dto/create-complaint.dto';
import type { ComplaintActionDto } from './dto/complaint-action.dto';
import type { ResolveComplaintDto } from './dto/resolve-complaint.dto';
import type { EscalateComplaintDto } from './dto/escalate-complaint.dto';
import type { ListComplaintsQueryDto } from './dto/list-complaints-query.dto';

/**
 * Process 42 — Complaints Management (backlog Part C #42, Domain E). Logs a
 * customer complaint (optionally linked to a disputed claim), tracks it
 * against an SLA timer, moves it through the `WORKFLOW_TRANSITIONS.Complaint`
 * state machine (`LOGGED -> ASSIGNED -> IN_PROGRESS -> {RESOLVED | ESCALATED}`,
 * `ESCALATED -> {IN_PROGRESS | RESOLVED}`, `RESOLVED -> CLOSED`), and enforces a
 * **mandatory supervisor sign-off before closure**: `close` (`complaint.close`
 * / MANAGER) requires a different user than the one who resolved it
 * (`assertDifferentActors` + the `Complaint_closure_maker_checker_distinct`
 * CHECK). An internally-unresolved complaint is routed out via `escalate`
 * (`complaint.escalate` / MANAGER, COMPLIANCE) — an `EscalationRecord` to the
 * CBJ Insurance Dispute Resolution Committee (default). The SLA timer is the
 * generic `SlaTimerService` engine (`complaint_resolution` — a DRAFTED
 * 10-business-day default); started best-effort at create, resolved when the
 * complaint is resolved / escalated.
 */
@Injectable()
export class ComplaintService {
  private readonly logger = new Logger(ComplaintService.name);

  constructor(
    private readonly repo: ComplaintRepository,
    private readonly workflow: WorkflowTransitionService,
    private readonly slaTimer: SlaTimerService,
    private readonly audit: AuditService,
  ) {}

  // --- 1. create -----------------------------------------------------

  async create(
    dto: CreateComplaintDto,
    actorUserId: string,
  ): Promise<ComplaintView> {
    if (!(await this.repo.customerExists(dto.customerId))) {
      throw new NotFoundException(`Customer ${dto.customerId} not found.`);
    }
    if (dto.claimId) {
      this.assertBelongsToCustomer(
        'Claim',
        dto.claimId,
        await this.repo.claimCustomerId(dto.claimId),
        dto.customerId,
      );
    }
    if (dto.policyId) {
      this.assertBelongsToCustomer(
        'Policy',
        dto.policyId,
        await this.repo.policyCustomerId(dto.policyId),
        dto.customerId,
      );
    }
    if (
      dto.responsibleEmployeeUserId &&
      !(await this.repo.userExists(dto.responsibleEmployeeUserId))
    ) {
      throw new NotFoundException(
        `User ${dto.responsibleEmployeeUserId} not found.`,
      );
    }

    const { id } = await this.repo.create({
      customerId: dto.customerId,
      claimId: dto.claimId ?? null,
      policyId: dto.policyId ?? null,
      issue: dto.issue,
      category: dto.category ?? null,
      responsibleEmployeeUserId: dto.responsibleEmployeeUserId ?? null,
    });

    // Best-effort SLA timer — the complaint is already committed; a timer
    // bookkeeping failure must not hide that it was logged (the A.8 /
    // AccessRecertificationService precedent, same as Process 41).
    await this.startSlaTimerBestEffort(id, actorUserId);

    const created = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'Complaint',
      entityId: id,
      afterValue: complaintAuditSnapshot({
        complaintId: id,
        customerId: created.customerId,
        claimId: created.claimId,
        policyId: created.policyId,
        issue: created.issue,
        category: created.category,
        status: created.status,
        responsibleEmployeeUserId: created.responsibleEmployeeUserId,
      }),
    });

    return deriveComplaintView(created);
  }

  private assertBelongsToCustomer(
    label: 'Claim' | 'Policy',
    id: string,
    ownerCustomerId: string | null,
    customerId: string,
  ): void {
    if (ownerCustomerId === null) {
      throw new NotFoundException(`${label} ${id} not found.`);
    }
    if (ownerCustomerId !== customerId) {
      throw new UnprocessableEntityException(
        `${label} ${id} does not belong to customer ${customerId}.`,
      );
    }
  }

  private async startSlaTimerBestEffort(
    complaintId: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      const dueAt = this.slaTimer.computeDueAt(
        COMPLAINT_SLA_WORKFLOW,
        new Date(),
      );
      const [timer] = await this.slaTimer.startTimer({
        entityType: 'Complaint',
        entityId: complaintId,
        workflowName: COMPLAINT_SLA_WORKFLOW,
        dueAt,
        actorUserId,
      });
      if (timer) {
        await this.repo.attachSlaTimer(complaintId, timer.id);
      }
    } catch (err) {
      this.logger.warn(
        `Complaint ${complaintId}: failed to start / attach its SLA timer — the complaint itself was logged: ${(err as Error).message}`,
      );
    }
  }

  // --- 2. assign -------------------------------------------------

  async assign(
    id: string,
    responsibleEmployeeUserId: string,
    actorUserId: string,
  ): Promise<ComplaintView> {
    const complaint = await this.load(id);
    this.assertNotClosed(complaint, 'reassigned');
    if (complaint.status === 'RESOLVED') {
      throw new UnprocessableEntityException(
        `Complaint ${id} is RESOLVED — awaiting closure sign-off, nothing to assign.`,
      );
    }
    if (!(await this.repo.userExists(responsibleEmployeeUserId))) {
      throw new NotFoundException(
        `User ${responsibleEmployeeUserId} not found.`,
      );
    }

    if (complaint.status === 'LOGGED') {
      await this.workflow.transition({
        entityType: 'Complaint',
        entityId: id,
        toStatus: 'ASSIGNED',
        actorUserId,
        data: { responsibleEmployeeUserId },
      });
    } else {
      const res = await this.repo.recordAssignee(id, responsibleEmployeeUserId);
      if (res.count === 0) {
        const now = await this.load(id);
        this.assertNotClosed(now, 'reassigned');
        if (now.status === 'RESOLVED') {
          throw new UnprocessableEntityException(
            `Complaint ${id} is RESOLVED — nothing to assign.`,
          );
        }
        throw new ConflictException(
          `Complaint ${id} changed concurrently — reload and retry.`,
        );
      }
    }

    const after = await this.load(id);
    await this.auditUpdate(actorUserId, after);
    return deriveComplaintView(after);
  }

  // --- 3. start ({ASSIGNED | ESCALATED} -> IN_PROGRESS) --------

  async start(id: string, actorUserId: string): Promise<ComplaintView> {
    const complaint = await this.load(id);
    if (complaint.status === 'IN_PROGRESS') {
      return deriveComplaintView(complaint); // idempotent
    }
    if (isTerminalComplaintStatus(complaint.status)) {
      throw new UnprocessableEntityException(
        `Complaint ${id} is CLOSED — it cannot be reopened.`,
      );
    }
    if (complaint.status === 'RESOLVED') {
      throw new UnprocessableEntityException(
        `Complaint ${id} is RESOLVED — awaiting closure sign-off.`,
      );
    }
    // Engine validates LOGGED (-> must assign first) and drives ASSIGNED /
    // ESCALATED -> IN_PROGRESS. A truly concurrent double-start races the 0-row
    // ConflictException from the engine — reload and return an idempotent 200 if
    // the row is now IN_PROGRESS (mirrors `assign` and #41's
    // ServiceRequestService.start), otherwise rethrow.
    try {
      await this.workflow.transition({
        entityType: 'Complaint',
        entityId: id,
        toStatus: 'IN_PROGRESS',
        actorUserId,
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (now.status === 'IN_PROGRESS') return deriveComplaintView(now);
      }
      throw err;
    }

    const after = await this.load(id);
    await this.auditUpdate(actorUserId, after);
    return deriveComplaintView(after);
  }

  // --- 4. add an action note -----------------------------------

  async addAction(
    id: string,
    dto: ComplaintActionDto,
    actorUserId: string,
  ): Promise<ComplaintView> {
    const complaint = await this.load(id);
    if (isTerminalComplaintStatus(complaint.status)) {
      throw new UnprocessableEntityException(
        `Complaint ${id} is CLOSED — no further actions.`,
      );
    }

    const { id: actionId } = await this.repo.createAction({
      complaintId: id,
      actionText: dto.actionText,
      takenByUserId: actorUserId,
    });
    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'ComplaintAction',
      entityId: actionId,
      afterValue: complaintActionAuditSnapshot({
        complaintActionId: actionId,
        complaintId: id,
        actionText: dto.actionText,
        takenByUserId: actorUserId,
      }),
    });

    return deriveComplaintView(await this.load(id));
  }

  // --- 5. resolve ({IN_PROGRESS | ESCALATED} -> RESOLVED) -----

  async resolve(
    id: string,
    dto: ResolveComplaintDto,
    actorUserId: string,
  ): Promise<ComplaintView> {
    const complaint = await this.load(id);

    if (complaint.status === 'RESOLVED') {
      if (complaint.resolution === dto.resolution) {
        return deriveComplaintView(complaint); // idempotent
      }
      throw new ConflictException(
        `Complaint ${id} is already RESOLVED with a different resolution.`,
      );
    }
    if (isTerminalComplaintStatus(complaint.status)) {
      throw new UnprocessableEntityException(
        `Complaint ${id} is already CLOSED.`,
      );
    }

    // Engine validates the from-state (LOGGED / ASSIGNED -> 422) and drives
    // IN_PROGRESS / ESCALATED -> RESOLVED. resolvedByUserId is the maker for
    // the closure sign-off; it is write-once (RESOLVED is not re-enterable).
    await this.workflow.transition({
      entityType: 'Complaint',
      entityId: id,
      toStatus: 'RESOLVED',
      actorUserId,
      data: {
        resolution: dto.resolution,
        resolvedByUserId: actorUserId,
        resolvedAt: new Date(),
      },
      sideEffect: () => this.resolveSlaTimerBestEffort(id, actorUserId),
    });

    const after = await this.load(id);
    await this.auditUpdate(actorUserId, after);
    return deriveComplaintView(after);
  }

  // --- 6. escalate (IN_PROGRESS -> ESCALATED) -----------------

  async escalate(
    id: string,
    dto: EscalateComplaintDto,
    actorUserId: string,
  ): Promise<ComplaintView> {
    const complaint = await this.load(id);
    if (isTerminalComplaintStatus(complaint.status)) {
      throw new UnprocessableEntityException(
        `Complaint ${id} is CLOSED — it cannot be escalated.`,
      );
    }
    if (complaint.status === 'RESOLVED') {
      throw new UnprocessableEntityException(
        `Complaint ${id} is RESOLVED — it was settled internally.`,
      );
    }

    const escalatedTo = dto.escalatedTo ?? DEFAULT_ESCALATION_TARGET;
    const reason = dto.reason ?? null;

    if (complaint.status === 'ESCALATED') {
      // Idempotent no-op. There is deliberately NO count-then-create "self-heal"
      // of a missed EscalationRecord: that is exactly the race
      // `race-safe-invariants.md` forbids (two concurrent retries both read
      // count 0 and both create), and a UNIQUE backstop is wrong here because
      // ESCALATED -> IN_PROGRESS -> ESCALATED is a legal loop that SHOULD mint a
      // second record. The `EscalationRecord` write below is a best-effort
      // engine `sideEffect` like every other in this codebase (a missed SLA
      // resolve, a missed audit row) — on the rare DB blip that drops it the
      // engine's TRANSITION row is the authoritative "it was escalated" record;
      // an operator re-runs a fresh IN_PROGRESS -> ESCALATED cycle to re-record
      // the target / reason.
      return deriveComplaintView(complaint);
    }

    // Engine validates the from-state (only IN_PROGRESS -> ESCALATED is legal;
    // LOGGED / ASSIGNED -> 422) and writes the TRANSITION row. The
    // EscalationRecord + SLA resolve run in the sideEffect — committed after the
    // status, best-effort (a failure is logged, not thrown: the complaint is
    // already ESCALATED and returning a 500 would be misleading).
    await this.workflow.transition({
      entityType: 'Complaint',
      entityId: id,
      toStatus: 'ESCALATED',
      actorUserId,
      sideEffect: async () => {
        await this.writeEscalation(id, escalatedTo, actorUserId, reason);
        await this.resolveSlaTimerBestEffort(id, actorUserId);
      },
    });

    return deriveComplaintView(await this.load(id));
  }

  private async writeEscalation(
    complaintId: string,
    escalatedTo: string,
    actorUserId: string,
    reason: string | null,
  ): Promise<void> {
    const { id: escalationId } = await this.repo.createEscalation({
      complaintId,
      escalatedTo,
      escalatedByUserId: actorUserId,
      reason,
    });
    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'EscalationRecord',
      entityId: escalationId,
      afterValue: escalationAuditSnapshot({
        escalationRecordId: escalationId,
        complaintId,
        escalatedTo,
        escalatedByUserId: actorUserId,
        reason,
      }),
    });
  }

  // --- 7. close (RESOLVED -> CLOSED; mandatory supervisor sign-off) --

  async close(id: string, actorUserId: string): Promise<ComplaintView> {
    const complaint = await this.load(id);
    if (isTerminalComplaintStatus(complaint.status)) {
      return deriveComplaintView(complaint); // idempotent
    }
    if (complaint.status !== 'RESOLVED') {
      throw new UnprocessableEntityException(
        `Complaint ${id} is ${complaint.status} — it must be RESOLVED before closure.`,
      );
    }
    // Mandatory supervisor sign-off (Part 5.2 / maker-checker-segregation.md).
    // Fail CLOSED, not open: a RESOLVED complaint with no recorded resolver
    // means the segregation check has nothing to compare against, so reject it
    // rather than pass `?? ''` (which no real actorUserId can equal). No code
    // path produces this today — `resolve` persists `resolvedByUserId` in the
    // same `updateMany` as the status — but the guard must not silently no-op
    // if one ever does.
    if (!complaint.resolvedByUserId) {
      throw new UnprocessableEntityException(
        `Complaint ${id} is RESOLVED but has no recorded resolver — closure sign-off cannot be verified.`,
      );
    }
    // resolvedByUserId is write-once once RESOLVED is reached (RESOLVED -> CLOSED
    // only, and neither `resolve` nor `close` rewrites it), so this pre-check is
    // race-safe; the Complaint_closure_maker_checker_distinct CHECK is the DB
    // backstop.
    assertDifferentActors(
      complaint.resolvedByUserId,
      actorUserId,
      'Complaint.close',
    );

    await this.workflow.transition({
      entityType: 'Complaint',
      entityId: id,
      toStatus: 'CLOSED',
      actorUserId,
      // The engine's updateMany `where` pins status: 'RESOLVED' only. That
      // transitively pins the maker: RESOLVED goes only to CLOSED, and
      // resolvedByUserId is never rewritten, so a concurrent writer cannot
      // change the value assertDifferentActors just validated. The DB CHECK is
      // the final backstop. (transition() cannot take extra where predicates.)
      data: {
        closureApprovedByUserId: actorUserId,
        closedAt: new Date(),
      },
      sideEffect: () => this.resolveSlaTimerBestEffort(id, actorUserId),
    });

    const after = await this.load(id);
    await this.auditUpdate(actorUserId, after);
    return deriveComplaintView(after);
  }

  private async resolveSlaTimerBestEffort(
    complaintId: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.slaTimer.resolve({
        entityType: 'Complaint',
        entityId: complaintId,
        workflowName: COMPLAINT_SLA_WORKFLOW,
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `Complaint ${complaintId}: failed to resolve its SLA timer (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  // --- reads -----------------------------------------------------

  async get(id: string): Promise<ComplaintView> {
    return deriveComplaintView(await this.load(id));
  }

  async list(query: ListComplaintsQueryDto): Promise<ComplaintView[]> {
    const rows = await this.repo.findMany(
      {
        customerId: query.customerId,
        status: query.status,
        claimId: query.claimId,
        responsibleEmployeeUserId: query.responsibleEmployeeUserId,
      },
      COMPLAINT_READ_LIMIT,
    );
    if (rows.length >= COMPLAINT_READ_LIMIT) {
      this.logger.warn(
        `Complaint list truncated at ${COMPLAINT_READ_LIMIT} rows — narrow with customerId / status / claimId / responsibleEmployeeUserId.`,
      );
    }
    const now = new Date();
    return rows.map((r) => deriveComplaintView(r, now));
  }

  // --- helpers -------------------------------------------------

  private async load(id: string): Promise<ComplaintWithDetail> {
    const complaint = await this.repo.findById(id);
    if (!complaint) {
      throw new NotFoundException(`Complaint ${id} not found.`);
    }
    return complaint;
  }

  private assertNotClosed(complaint: { status: string }, verb: string): void {
    if (isTerminalComplaintStatus(complaint.status)) {
      throw new UnprocessableEntityException(
        `Complaint is CLOSED — it cannot be ${verb}.`,
      );
    }
  }

  private async auditUpdate(
    actorUserId: string,
    after: ComplaintWithDetail,
  ): Promise<void> {
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Complaint',
      entityId: after.id,
      afterValue: complaintUpdateAuditSnapshot({
        complaintId: after.id,
        customerId: after.customerId,
        status: after.status,
        responsibleEmployeeUserId: after.responsibleEmployeeUserId,
        resolution: after.resolution,
        resolvedByUserId: after.resolvedByUserId,
        closureApprovedByUserId: after.closureApprovedByUserId,
        closedAt: after.closedAt,
      }),
    });
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Complaint audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
