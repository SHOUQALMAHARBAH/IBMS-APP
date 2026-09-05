import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DataSubjectRequest } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { SlaTimerService } from '../sla/sla-timer.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { assertDifferentActors } from '../../common/maker-checker.util';
import { hasExactlyOneOwner } from '../../common/dto.util';
import { DsrRepository } from '../../repositories/dsr.repository';
import {
  applyDsrExtension,
  canApplyDsrExtension,
  deriveDsrView,
  dsrCreateAuditSnapshot,
  dsrSlaWorkflowFor,
  dsrUpdateAuditSnapshot,
  isDsrClosed,
  isDsrProcessed,
  type DataSubjectRequestView,
} from './dsr.config';
import type { CreateDsrDto } from './dto/create-dsr.dto';
import type { AssignDsrDto } from './dto/assign-dsr.dto';
import type { ApplyDsrExtensionDto } from './dto/apply-dsr-extension.dto';
import type { FulfilDsrDto } from './dto/fulfil-dsr.dto';
import type { PartiallyFulfilDsrDto } from './dto/partially-fulfil-dsr.dto';
import type { RejectDsrDto } from './dto/reject-dsr.dto';
import type { ListDsrQueryDto } from './dto/list-dsr-query.dto';

/** Cap on a book-wide `DataSubjectRequest` list. */
const DSR_READ_LIMIT = 5000;

/**
 * M04 — Data Subject Request Management (backlog Part D, bundled under
 * Process #52 "Data Protection Compliance"). Logs an Access/Correction/
 * Deletion/Objection request, moves it through
 * `WORKFLOW_TRANSITIONS.DataSubjectRequest` (`RECEIVED -> IDENTITY_VERIFIED
 * -> IN_PROGRESS -> {FULFILLED | PARTIALLY_FULFILLED | REJECTED} ->
 * CLOSED`, `REJECTED` also reachable straight from `RECEIVED` /
 * `IDENTITY_VERIFIED`), and tracks it against the generic `SlaTimerService`
 * engine's two DSR entries (`dsr_access_deletion` 15 business days,
 * `dsr_correction_objection` 10 — both with the DPO-then-General-Manager
 * two-stage escalation `SLA_REGISTRY` already defines).
 *
 * **Mandatory DPO sign-off before closure** (Part 5.2 /
 * maker-checker-segregation.md — CLAUDE.md's own summary names "DSR
 * closure" as covered): `close` (`dsr.close`) requires a DIFFERENT DPO
 * officer than whoever drove the terminal outcome (`processedByUserId`,
 * stamped by `fulfil`/`partiallyFulfil`/`reject`) — `assertDifferentActors`
 * + the `DataSubjectRequest_closure_maker_checker_distinct` CHECK. Both
 * `dsr.handle` and `dsr.close` are DPO-only, so this segregates between two
 * distinct DPO officers, not between roles.
 *
 * Reads are audited (`isSensitiveDataAccess: true`) — a DSR is a data
 * subject's own exercise of a PDPL right (Access/Correction/Deletion/
 * Objection), the most privacy-central content this system holds, closer
 * in kind to `Claim`/`TransactionMonitoringAlert` (audited every read) than
 * to the Confidential-tier #33/#34/#41/#44/#45/#46/#51 no-audit precedent.
 */
@Injectable()
export class DsrService {
  private readonly logger = new Logger(DsrService.name);

  constructor(
    private readonly repo: DsrRepository,
    private readonly workflow: WorkflowTransitionService,
    private readonly slaTimer: SlaTimerService,
    private readonly audit: AuditService,
  ) {}

  // --- 1. create (RECEIVED, "logged the same business day") ---------

  async create(
    dto: CreateDsrDto,
    actorUserId: string,
  ): Promise<DataSubjectRequestView> {
    if (!hasExactlyOneOwner(dto)) {
      throw new UnprocessableEntityException(
        'Exactly one of customerId / insuredPersonId must identify the data subject.',
      );
    }
    if (dto.customerId && !(await this.repo.customerExists(dto.customerId))) {
      throw new NotFoundException(`Customer ${dto.customerId} not found.`);
    }
    if (
      dto.insuredPersonId &&
      !(await this.repo.insuredPersonExists(dto.insuredPersonId))
    ) {
      throw new NotFoundException(
        `Insured person ${dto.insuredPersonId} not found.`,
      );
    }
    if (
      dto.dpoHandlerUserId &&
      !(await this.repo.userExists(dto.dpoHandlerUserId))
    ) {
      throw new NotFoundException(`User ${dto.dpoHandlerUserId} not found.`);
    }

    const workflowName = dsrSlaWorkflowFor(
      dto.type as DataSubjectRequest['type'],
    );
    const receivedAt = new Date();
    const slaDueAt = this.slaTimer.computeDueAt(workflowName, receivedAt);

    const row = await this.repo.create({
      customerId: dto.customerId ?? null,
      insuredPersonId: dto.insuredPersonId ?? null,
      type: dto.type as DataSubjectRequest['type'],
      slaDueAt,
      dpoHandlerUserId: dto.dpoHandlerUserId ?? null,
    });

    await this.startSlaTimerBestEffort(
      row.id,
      workflowName,
      slaDueAt,
      actorUserId,
    );

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'DataSubjectRequest',
      entityId: row.id,
      afterValue: dsrCreateAuditSnapshot(row),
      isSensitiveDataAccess: true,
    });

    return deriveDsrView(row, new Date());
  }

  /** Returns whether the timer(s) were actually created — `applyExtension`
   * uses this to decide whether it's safe to resolve the pre-extension
   * rows afterward (see its own comment). */
  private async startSlaTimerBestEffort(
    id: string,
    workflowName: string,
    dueAt: Date,
    actorUserId: string,
  ): Promise<boolean> {
    try {
      await this.slaTimer.startTimer({
        entityType: 'DataSubjectRequest',
        entityId: id,
        workflowName,
        dueAt,
        actorUserId,
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `DataSubjectRequest ${id}: failed to start its SLA timer — the request itself was logged: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async resolveSlaTimerBestEffort(
    id: string,
    workflowName: string,
    actorUserId: string,
    createdBefore?: Date,
  ): Promise<void> {
    try {
      await this.slaTimer.resolve({
        entityType: 'DataSubjectRequest',
        entityId: id,
        workflowName,
        actorUserId,
        createdBefore,
      });
    } catch (err) {
      this.logger.warn(
        `DataSubjectRequest ${id}: failed to resolve its SLA timer (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  // --- 2. verify-identity (RECEIVED -> IDENTITY_VERIFIED) ------------

  async verifyIdentity(
    id: string,
    actorUserId: string,
  ): Promise<DataSubjectRequestView> {
    const dsr = await this.load(id);
    if (dsr.status === 'IDENTITY_VERIFIED') {
      return deriveDsrView(dsr, new Date()); // idempotent
    }

    // A truly concurrent double-call races the engine's 0-row
    // ConflictException — reload and return idempotent if the row is now
    // IDENTITY_VERIFIED (the `start()` shape below, applied uniformly).
    try {
      await this.workflow.transition({
        entityType: 'DataSubjectRequest',
        entityId: id,
        toStatus: 'IDENTITY_VERIFIED',
        actorUserId,
        data: { identityVerifiedAt: new Date() },
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (now.status === 'IDENTITY_VERIFIED') {
          return deriveDsrView(now, new Date());
        }
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 3. start (IDENTITY_VERIFIED -> IN_PROGRESS) -------------------

  async start(
    id: string,
    actorUserId: string,
  ): Promise<DataSubjectRequestView> {
    const dsr = await this.load(id);
    if (dsr.status === 'IN_PROGRESS') {
      return deriveDsrView(dsr, new Date()); // idempotent
    }

    // Engine validates the from-state (RECEIVED -> 422, must verify identity
    // first) and drives IDENTITY_VERIFIED -> IN_PROGRESS. A truly concurrent
    // double-start races the 0-row ConflictException from the engine —
    // reload and return idempotent if the row is now IN_PROGRESS (the
    // #42 `ComplaintService.start` shape).
    try {
      await this.workflow.transition({
        entityType: 'DataSubjectRequest',
        entityId: id,
        toStatus: 'IN_PROGRESS',
        actorUserId,
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (now.status === 'IN_PROGRESS') return deriveDsrView(now, new Date());
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 4. assign / reassign the DPO handler --------------------------

  async assign(
    id: string,
    dto: AssignDsrDto,
    actorUserId: string,
  ): Promise<DataSubjectRequestView> {
    const dsr = await this.load(id);
    this.assertNotProcessedOrClosed(dsr, 'reassigned');
    if (!(await this.repo.userExists(dto.dpoHandlerUserId))) {
      throw new NotFoundException(`User ${dto.dpoHandlerUserId} not found.`);
    }

    const res = await this.repo.recordHandlerAssignment(
      id,
      dto.dpoHandlerUserId,
    );
    if (res.count === 0) {
      const now = await this.load(id);
      this.assertNotProcessedOrClosed(now, 'reassigned');
      throw new ConflictException(
        `Data Subject Request ${id} changed concurrently — reload and retry.`,
      );
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 5. apply-extension (ACCESS only, +15 business days, once) ----

  async applyExtension(
    id: string,
    dto: ApplyDsrExtensionDto,
    actorUserId: string,
  ): Promise<DataSubjectRequestView> {
    const dsr = await this.load(id);
    this.assertNotProcessedOrClosed(dsr, 'extended');
    if (!canApplyDsrExtension(dsr.type)) {
      throw new UnprocessableEntityException(
        `Data Subject Request ${id} is type ${dsr.type} — the +15 business-day extension is ACCESS-only.`,
      );
    }
    if (dsr.accessExtensionAppliedAt !== null) {
      throw new UnprocessableEntityException(
        `Data Subject Request ${id} has already used its one extension.`,
      );
    }

    const newSlaDueAt = applyDsrExtension(dsr.slaDueAt);
    const appliedAt = new Date();
    const res = await this.repo.applyExtension(
      id,
      newSlaDueAt,
      dto.reason,
      appliedAt,
    );
    if (res.count === 0) {
      throw new ConflictException(
        `Data Subject Request ${id} changed concurrently — reload and retry.`,
      );
    }

    // Best-effort re-basing via two calls to the existing public engine API
    // (no "update dueAt" method exists — see dsr.config.ts's header
    // comment), deliberately ordered START-then-resolve, not the naive
    // resolve-then-start: the old and new rows share the same
    // `workflowName` (the DSR's type never changes on extension), so
    // `resolve()`'s own `startsWith` match would otherwise also catch rows
    // `startTimer()` just created — `rebaseCutoff` (captured before either
    // call) plus `resolve()`'s `createdBefore` filter excludes them.
    // Consequences of a partial failure under this ordering are always the
    // safer of the two possible bad states: if `startTimer` itself fails,
    // `resolve` is skipped entirely and the pre-extension timer(s) are left
    // open — a false-EARLY escalation against the now-superseded deadline a
    // human can dismiss, not a silent gap with no open timer covering this
    // DSR at all. If `startTimer` succeeds but the follow-up `resolve`
    // fails, the pre-extension rows simply stay open alongside the new
    // ones — a harmless, human-visible duplicate, not lost coverage.
    const workflowName = dsrSlaWorkflowFor(dsr.type);
    const rebaseCutoff = new Date();
    const started = await this.startSlaTimerBestEffort(
      id,
      workflowName,
      newSlaDueAt,
      actorUserId,
    );
    if (started) {
      await this.resolveSlaTimerBestEffort(
        id,
        workflowName,
        actorUserId,
        rebaseCutoff,
      );
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 6. fulfil (IN_PROGRESS -> FULFILLED) --------------------------

  async fulfil(
    id: string,
    dto: FulfilDsrDto,
    actorUserId: string,
  ): Promise<DataSubjectRequestView> {
    const dsr = await this.load(id);
    if (dsr.status === 'FULFILLED') {
      return deriveDsrView(dsr, new Date()); // idempotent
    }
    if (dsr.type === 'DELETION' && dto.confirmNoOpenRetentionHold !== true) {
      throw new UnprocessableEntityException(
        `Data Subject Request ${id} is a DELETION request — it cannot be marked fully fulfilled without confirming no retention hold applies (confirmNoOpenRetentionHold: true). Use partially-fulfil if one does.`,
      );
    }

    const workflowName = dsrSlaWorkflowFor(dsr.type);
    try {
      await this.workflow.transition({
        entityType: 'DataSubjectRequest',
        entityId: id,
        toStatus: 'FULFILLED',
        actorUserId,
        data: {
          processedByUserId: actorUserId,
          // Persist the DELETION attestation this guard just required — a
          // @code-reviewer MAJOR on the first pass: the flag was validated
          // in-memory and then discarded, leaving no record of which DPO
          // officer attested "no retention hold applies" before closing a
          // Deletion request as fully fulfilled.
          ...(dsr.type === 'DELETION'
            ? { noOpenRetentionHoldConfirmedAt: new Date() }
            : {}),
        },
        sideEffect: () =>
          this.resolveSlaTimerBestEffort(id, workflowName, actorUserId),
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (now.status === 'FULFILLED') return deriveDsrView(now, new Date());
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 7. partially-fulfil (IN_PROGRESS -> PARTIALLY_FULFILLED) -----

  async partiallyFulfil(
    id: string,
    dto: PartiallyFulfilDsrDto,
    actorUserId: string,
  ): Promise<DataSubjectRequestView> {
    const dsr = await this.load(id);
    if (dsr.status === 'PARTIALLY_FULFILLED') {
      if (
        dsr.retentionScheduleReference === dto.retentionScheduleReference &&
        dsr.partialFulfilmentJustification ===
          dto.partialFulfilmentJustification
      ) {
        return deriveDsrView(dsr, new Date()); // idempotent
      }
      throw new ConflictException(
        `Data Subject Request ${id} is already PARTIALLY_FULFILLED with a different reference/justification.`,
      );
    }

    const workflowName = dsrSlaWorkflowFor(dsr.type);
    try {
      await this.workflow.transition({
        entityType: 'DataSubjectRequest',
        entityId: id,
        toStatus: 'PARTIALLY_FULFILLED',
        actorUserId,
        data: {
          retentionScheduleReference: dto.retentionScheduleReference,
          partialFulfilmentJustification: dto.partialFulfilmentJustification,
          processedByUserId: actorUserId,
        },
        sideEffect: () =>
          this.resolveSlaTimerBestEffort(id, workflowName, actorUserId),
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (
          now.status === 'PARTIALLY_FULFILLED' &&
          now.retentionScheduleReference === dto.retentionScheduleReference &&
          now.partialFulfilmentJustification ===
            dto.partialFulfilmentJustification
        ) {
          return deriveDsrView(now, new Date());
        }
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 8. reject (RECEIVED | IDENTITY_VERIFIED | IN_PROGRESS -> REJECTED) --

  async reject(
    id: string,
    dto: RejectDsrDto,
    actorUserId: string,
  ): Promise<DataSubjectRequestView> {
    const dsr = await this.load(id);
    if (dsr.status === 'REJECTED') {
      if (dsr.rejectionReason === dto.reason) {
        return deriveDsrView(dsr, new Date()); // idempotent
      }
      throw new ConflictException(
        `Data Subject Request ${id} is already REJECTED with a different reason.`,
      );
    }

    const workflowName = dsrSlaWorkflowFor(dsr.type);
    try {
      await this.workflow.transition({
        entityType: 'DataSubjectRequest',
        entityId: id,
        toStatus: 'REJECTED',
        actorUserId,
        data: { rejectionReason: dto.reason, processedByUserId: actorUserId },
        sideEffect: () =>
          this.resolveSlaTimerBestEffort(id, workflowName, actorUserId),
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (now.status === 'REJECTED' && now.rejectionReason === dto.reason) {
          return deriveDsrView(now, new Date());
        }
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 9. close ({PARTIALLY_FULFILLED | FULFILLED | REJECTED} -> CLOSED) --
  // Mandatory DPO sign-off — see this class's own header comment.

  async close(
    id: string,
    actorUserId: string,
  ): Promise<DataSubjectRequestView> {
    const dsr = await this.load(id);
    if (isDsrClosed(dsr.status)) {
      return deriveDsrView(dsr, new Date()); // idempotent
    }
    if (!isDsrProcessed(dsr.status)) {
      throw new UnprocessableEntityException(
        `Data Subject Request ${id} is ${dsr.status} — it must be FULFILLED, PARTIALLY_FULFILLED, or REJECTED before closure.`,
      );
    }
    // Fail CLOSED, not open: a processed DSR with no recorded processor
    // means the segregation check has nothing to compare against — reject
    // rather than pass `?? ''` (which no real actorUserId can equal). No
    // code path produces this today (fulfil/partiallyFulfil/reject all
    // persist processedByUserId in the same write as the status), but the
    // guard must not silently no-op if one ever does (the #42 `Complaint.
    // close` precedent).
    if (!dsr.processedByUserId) {
      throw new UnprocessableEntityException(
        `Data Subject Request ${id} is ${dsr.status} but has no recorded processor — closure sign-off cannot be verified.`,
      );
    }
    assertDifferentActors(
      dsr.processedByUserId,
      actorUserId,
      'DataSubjectRequest.close',
    );

    try {
      await this.workflow.transition({
        entityType: 'DataSubjectRequest',
        entityId: id,
        toStatus: 'CLOSED',
        actorUserId,
        data: { closedByUserId: actorUserId, closedAt: new Date() },
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (isDsrClosed(now.status)) return deriveDsrView(now, new Date());
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- reads -----------------------------------------------------

  async get(id: string, actorUserId: string): Promise<DataSubjectRequestView> {
    const dsr = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'DataSubjectRequest',
      entityId: id,
      afterValue: { dataSubjectRequestId: id },
      isSensitiveDataAccess: true,
    });
    return deriveDsrView(dsr, new Date());
  }

  async list(
    query: ListDsrQueryDto,
    actorUserId: string,
  ): Promise<DataSubjectRequestView[]> {
    const now = new Date();
    const rows = await this.repo.findMany(
      {
        customerId: query.customerId,
        insuredPersonId: query.insuredPersonId,
        status: query.status,
        type: query.type,
        dpoHandlerUserId: query.dpoHandlerUserId,
      },
      DSR_READ_LIMIT,
    );
    if (rows.length >= DSR_READ_LIMIT) {
      this.logger.warn(
        `Data Subject Request list truncated at ${DSR_READ_LIMIT} rows — narrow with customerId / insuredPersonId / status / type / dpoHandlerUserId.`,
      );
    }
    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'DataSubjectRequest',
      entityId: 'list',
      afterValue: { count: rows.length },
      isSensitiveDataAccess: rows.length > 0,
    });
    return rows.map((r) => deriveDsrView(r, now));
  }

  // --- helpers -------------------------------------------------

  private async load(id: string): Promise<DataSubjectRequest> {
    const dsr = await this.repo.findById(id);
    if (!dsr) {
      throw new NotFoundException(`Data Subject Request ${id} not found.`);
    }
    return dsr;
  }

  private assertNotProcessedOrClosed(
    dsr: DataSubjectRequest,
    verb: string,
  ): void {
    if (isDsrClosed(dsr.status) || isDsrProcessed(dsr.status)) {
      throw new UnprocessableEntityException(
        `Data Subject Request is ${dsr.status} — it cannot be ${verb}.`,
      );
    }
  }

  private async reloadAndAuditUpdate(
    id: string,
    actorUserId: string,
  ): Promise<DataSubjectRequestView> {
    const after = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'DataSubjectRequest',
      entityId: after.id,
      afterValue: dsrUpdateAuditSnapshot(after),
      isSensitiveDataAccess: true,
    });
    return deriveDsrView(after, new Date());
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `DataSubjectRequest audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
