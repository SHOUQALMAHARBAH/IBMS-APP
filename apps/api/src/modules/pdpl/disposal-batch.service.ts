import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DisposalBatch } from '@ibms/db';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { SlaTimerService } from '../sla/sla-timer.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { assertDifferentActors } from '../../common/maker-checker.util';
import { DisposalBatchRepository } from '../../repositories/disposal-batch.repository';
import { LegalHoldRepository } from '../../repositories/legal-hold.repository';
import {
  DISPOSAL_BATCH_SLA_WORKFLOW,
  deriveDisposalBatchView,
  disposalBatchAuditSnapshot,
  type DisposalBatchView,
} from './disposal-batch.config';
import type { CreateDisposalBatchDto } from './dto/create-disposal-batch.dto';
import type { RecordDisposalExecutionDto } from './dto/record-disposal-execution.dto';
import type { ListDisposalBatchesQueryDto } from './dto/list-disposal-batches-query.dto';

const P2002 = 'P2002';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
  );
}

/**
 * M06 — Disposal Batch (backlog Part D §5.1, Process #52). Dual control,
 * strictly linear (`WORKFLOW_TRANSITIONS.DisposalBatch`, pre-seeded ahead
 * of this module): `NOMINATED -> MANAGER_APPROVED -> DPO_APPROVED ->
 * EXECUTED -> CLOSED`.
 *
 *   - `nominate` (`retention.dispose.nominate`, Manager) — the maker.
 *   - `managerApprove` (same permission) — a checkpoint before DPO review,
 *     not a second distinct actor: the model has no separate
 *     `managerApprovedByUserId` column, only a timestamp, and the DB CHECK
 *     compares `dpoApprovedByUserId` against `nominatedByUserId` — never
 *     against a manager-approval identity that doesn't exist as a column.
 *   - `dpoApprove` (`retention.dispose.approve`, DPO) — the checker.
 *     `assertDifferentActors` + the pre-existing
 *     `DisposalBatch_maker_checker_distinct` CHECK both guard
 *     `dpoApprovedByUserId != nominatedByUserId`. Stamps `slaDueAt` (30
 *     calendar days from HERE, not from nomination — the model's own field
 *     comment sits after `dpoApprovedAt`) and starts the
 *     `disposal_batch_execution` SLA timer.
 *   - `execute` — a staff attestation that the named external destruction
 *     `method` happened; resolves the execution SLA timer.
 *   - `close` — REQUIRES a `CertificateOfDestruction` already attached
 *     (422 otherwise) — "no closing a disposal batch without one," the
 *     backlog's own words.
 *
 * **Legal Hold exclusion is re-checked at every dual-control step, not
 * just once at nomination** — a hold placed AFTER nomination but before an
 * approval must still block the next step, the #16 `RecommendationService`
 * "re-derive the approval gate from live data" discipline applied here.
 */
@Injectable()
export class DisposalBatchService {
  private readonly logger = new Logger(DisposalBatchService.name);

  constructor(
    private readonly repo: DisposalBatchRepository,
    private readonly legalHolds: LegalHoldRepository,
    private readonly workflow: WorkflowTransitionService,
    private readonly slaTimer: SlaTimerService,
    private readonly audit: AuditService,
  ) {}

  async nominate(
    dto: CreateDisposalBatchDto,
    actorUserId: string,
  ): Promise<DisposalBatchView> {
    if (
      dto.retentionScheduleItemId &&
      !(await this.repo.retentionScheduleItemExists(
        dto.retentionScheduleItemId,
      ))
    ) {
      throw new NotFoundException(
        `Retention schedule item ${dto.retentionScheduleItemId} not found.`,
      );
    }
    await this.assertNoActiveLegalHold(dto.retentionScheduleItemId ?? null);

    const row = await this.repo.create({
      retentionScheduleItemId: dto.retentionScheduleItemId ?? null,
      nominatedByUserId: actorUserId,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'DisposalBatch',
      entityId: row.id,
      afterValue: disposalBatchAuditSnapshot(row),
    });

    return this.toView(row);
  }

  async managerApprove(
    id: string,
    actorUserId: string,
  ): Promise<DisposalBatchView> {
    const batch = await this.load(id);
    if (batch.status === 'MANAGER_APPROVED') {
      return this.toView(batch); // idempotent
    }
    await this.assertNoActiveLegalHold(batch.retentionScheduleItemId);

    try {
      await this.workflow.transition({
        entityType: 'DisposalBatch',
        entityId: id,
        toStatus: 'MANAGER_APPROVED',
        actorUserId,
        data: { managerApprovedAt: new Date() },
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (now.status === 'MANAGER_APPROVED') return this.toView(now);
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  async dpoApprove(
    id: string,
    actorUserId: string,
  ): Promise<DisposalBatchView> {
    const batch = await this.load(id);
    if (batch.status === 'DPO_APPROVED') {
      return this.toView(batch); // idempotent
    }
    assertDifferentActors(
      batch.nominatedByUserId,
      actorUserId,
      'DisposalBatch.dpoApprove',
    );
    await this.assertNoActiveLegalHold(batch.retentionScheduleItemId);

    const dpoApprovedAt = new Date();
    const slaDueAt = await this.slaTimer.computeDueAt(
      DISPOSAL_BATCH_SLA_WORKFLOW,
      dpoApprovedAt,
    );

    try {
      await this.workflow.transition({
        entityType: 'DisposalBatch',
        entityId: id,
        toStatus: 'DPO_APPROVED',
        actorUserId,
        data: {
          dpoApprovedByUserId: actorUserId,
          dpoApprovedAt,
          slaDueAt,
        },
        sideEffect: () =>
          this.startSlaTimerBestEffort(id, slaDueAt, actorUserId),
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (now.status === 'DPO_APPROVED') return this.toView(now);
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  async execute(
    id: string,
    dto: RecordDisposalExecutionDto,
    actorUserId: string,
  ): Promise<DisposalBatchView> {
    const batch = await this.load(id);
    if (batch.status === 'EXECUTED') {
      if (batch.method === dto.method) {
        return this.toView(batch); // idempotent
      }
      throw new ConflictException(
        `DisposalBatch ${id} is already EXECUTED with a different method.`,
      );
    }

    try {
      await this.workflow.transition({
        entityType: 'DisposalBatch',
        entityId: id,
        toStatus: 'EXECUTED',
        actorUserId,
        data: { method: dto.method, executedAt: new Date() },
        sideEffect: () => this.resolveSlaTimerBestEffort(id, actorUserId),
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (now.status === 'EXECUTED' && now.method === dto.method) {
          return this.toView(now);
        }
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  /** Not a status transition — attaches the `CertificateOfDestruction` a
   * `close()` will require. Only meaningful once destruction has actually
   * been attested (`EXECUTED`). */
  async issueCertificate(
    id: string,
    actorUserId: string,
  ): Promise<DisposalBatchView> {
    const batch = await this.load(id);
    if (batch.status !== 'EXECUTED' && batch.status !== 'CLOSED') {
      throw new UnprocessableEntityException(
        `DisposalBatch ${id} is ${batch.status} — a Certificate of Destruction can only be issued once destruction has been recorded (EXECUTED).`,
      );
    }

    try {
      await this.repo.createCertificate({
        disposalBatchId: id,
        issuedByUserId: actorUserId,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `DisposalBatch ${id} already has a Certificate of Destruction attached.`,
        );
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  /** EXECUTED -> CLOSED. Requires a `CertificateOfDestruction` already
   * attached — "no closing a disposal batch without one," the backlog's
   * own words. */
  async close(id: string, actorUserId: string): Promise<DisposalBatchView> {
    const batch = await this.load(id);
    if (batch.status === 'CLOSED') {
      return this.toView(batch); // idempotent
    }
    const certificate = await this.repo.findCertificateByBatchId(id);
    if (!certificate) {
      throw new UnprocessableEntityException(
        `DisposalBatch ${id} cannot be closed — no Certificate of Destruction is attached yet. Issue one first.`,
      );
    }

    try {
      await this.workflow.transition({
        entityType: 'DisposalBatch',
        entityId: id,
        toStatus: 'CLOSED',
        actorUserId,
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (now.status === 'CLOSED') return this.toView(now);
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- reads -----------------------------------------------------

  async get(id: string): Promise<DisposalBatchView> {
    return this.toView(await this.load(id));
  }

  async list(query: ListDisposalBatchesQueryDto): Promise<DisposalBatchView[]> {
    const rows = await this.repo.findMany({
      retentionScheduleItemId: query.retentionScheduleItemId,
      status: query.status,
    });
    return Promise.all(rows.map((r) => this.toView(r)));
  }

  // --- helpers -------------------------------------------------

  private async load(id: string): Promise<DisposalBatch> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Disposal batch ${id} not found.`);
    }
    return row;
  }

  private async toView(row: DisposalBatch): Promise<DisposalBatchView> {
    const certificate = await this.repo.findCertificateByBatchId(row.id);
    return deriveDisposalBatchView(row, certificate !== null);
  }

  /** "Exclude records under an active Legal Hold from routine disposal" —
   * a no-op when the batch carries no `retentionScheduleItemId` (nothing
   * to exclude against). */
  private async assertNoActiveLegalHold(
    retentionScheduleItemId: string | null,
  ): Promise<void> {
    if (!retentionScheduleItemId) return;
    if (await this.legalHolds.hasActiveHold(retentionScheduleItemId)) {
      throw new UnprocessableEntityException(
        `Retention schedule item ${retentionScheduleItemId} is under an active Legal Hold — it is excluded from routine disposal.`,
      );
    }
  }

  private async startSlaTimerBestEffort(
    id: string,
    dueAt: Date,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.slaTimer.startTimer({
        entityType: 'DisposalBatch',
        entityId: id,
        workflowName: DISPOSAL_BATCH_SLA_WORKFLOW,
        dueAt,
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `DisposalBatch ${id}: failed to start its execution SLA timer: ${(err as Error).message}`,
      );
    }
  }

  private async resolveSlaTimerBestEffort(
    id: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.slaTimer.resolve({
        entityType: 'DisposalBatch',
        entityId: id,
        workflowName: DISPOSAL_BATCH_SLA_WORKFLOW,
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `DisposalBatch ${id}: failed to resolve its execution SLA timer (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  private async reloadAndAuditUpdate(
    id: string,
    actorUserId: string,
  ): Promise<DisposalBatchView> {
    const after = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'DisposalBatch',
      entityId: after.id,
      afterValue: disposalBatchAuditSnapshot(after),
    });
    return this.toView(after);
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `DisposalBatch audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
