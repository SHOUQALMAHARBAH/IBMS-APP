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
import { LegalHoldRepository } from '../../repositories/legal-hold.repository';
import {
  LEGAL_HOLD_REVIEW_SLA_WORKFLOW,
  deriveLegalHoldView,
  hasAtMostOneSubjectReference,
  legalHoldAuditSnapshot,
  type LegalHoldRow,
  type LegalHoldView,
} from './legal-hold.config';
import type { CreateLegalHoldDto } from './dto/create-legal-hold.dto';
import type { ListLegalHoldsQueryDto } from './dto/list-legal-holds-query.dto';

/**
 * M06 — Legal Hold (backlog Part D §5.1, Process #52). `legal-hold.manage`
 * (`[DATA_PROTECTION_OFFICER]`, pre-seeded) gates place/review/release.
 * Placing a hold starts the `legal_hold_necessity_review` SLA timer (6
 * months, `SLA_REGISTRY`, `escalateTo: 'DPO_AND_LEGAL_COUNSEL'`); a review
 * re-bases it, START-then-resolve with a `createdBefore` cutoff — the
 * `DsrService.applyExtension` shape, applied here because the old and new
 * timer rows share the identical `workflowName` (a review never changes
 * it), so `resolve()`'s own `startsWith` match would otherwise also catch
 * the row `startTimer()` just created if the old rows were resolved first.
 * Release is terminal — no further review is ever due once data can
 * finally be considered for routine disposal again.
 *
 * `create()` validates `customerId`/`insuredPersonId` the ConsentRecord/DSR
 * way (existence-checked, at most one — `hasAtMostOneSubjectReference`)
 * before a hold can name a data subject structurally; this is the register
 * `DsrService.fulfil()` now cross-checks live before letting a DELETION
 * request close as fully fulfilled.
 */
@Injectable()
export class LegalHoldService {
  private readonly logger = new Logger(LegalHoldService.name);

  constructor(
    private readonly repo: LegalHoldRepository,
    private readonly slaTimer: SlaTimerService,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateLegalHoldDto,
    actorUserId: string,
  ): Promise<LegalHoldView> {
    if (!hasAtMostOneSubjectReference(dto)) {
      throw new UnprocessableEntityException(
        'At most one of customerId / insuredPersonId may identify the data subject this hold covers.',
      );
    }
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

    const placedAt = new Date();
    const nextReviewDueAt = this.slaTimer.computeDueAt(
      LEGAL_HOLD_REVIEW_SLA_WORKFLOW,
      placedAt,
    );

    const row = await this.repo.create({
      scope: dto.scope,
      reason: dto.reason,
      nextReviewDueAt,
      retentionScheduleItemId: dto.retentionScheduleItemId ?? null,
      customerId: dto.customerId ?? null,
      insuredPersonId: dto.insuredPersonId ?? null,
    });

    await this.startSlaTimerBestEffort(row.id, nextReviewDueAt, actorUserId);

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'LegalHold',
      entityId: row.id,
      afterValue: legalHoldAuditSnapshot(row),
    });

    return deriveLegalHoldView(row);
  }

  async get(id: string): Promise<LegalHoldView> {
    return deriveLegalHoldView(await this.load(id));
  }

  async list(query: ListLegalHoldsQueryDto): Promise<LegalHoldView[]> {
    const rows = await this.repo.findMany({
      retentionScheduleItemId: query.retentionScheduleItemId,
      active: query.active,
      customerId: query.customerId,
      insuredPersonId: query.insuredPersonId,
    });
    return rows.map((r) => deriveLegalHoldView(r));
  }

  async recordReview(id: string, actorUserId: string): Promise<LegalHoldView> {
    const hold = await this.load(id);
    if (hold.releasedAt !== null) {
      throw new UnprocessableEntityException(
        `Legal Hold ${id} has already been released — it needs no further review.`,
      );
    }

    const newDueAt = this.slaTimer.computeDueAt(
      LEGAL_HOLD_REVIEW_SLA_WORKFLOW,
      new Date(),
    );
    const res = await this.repo.recordReview(id, newDueAt);
    if (res.count === 0) {
      const now = await this.load(id);
      if (now.releasedAt !== null) {
        throw new UnprocessableEntityException(
          `Legal Hold ${id} has already been released — it needs no further review.`,
        );
      }
      throw new ConflictException(
        `Legal Hold ${id} changed concurrently — reload and retry.`,
      );
    }

    // Same re-basing shape as DsrService.applyExtension: start the new
    // timer first, then resolve the old one(s) with a createdBefore cutoff
    // captured before either call — never the reverse, which could leave
    // zero open timers on a partial failure.
    const rebaseCutoff = new Date();
    const started = await this.startSlaTimerBestEffort(
      id,
      newDueAt,
      actorUserId,
    );
    if (started) {
      await this.resolveSlaTimerBestEffort(id, actorUserId, rebaseCutoff);
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  async release(id: string, actorUserId: string): Promise<LegalHoldView> {
    const hold = await this.load(id);
    if (hold.releasedAt !== null) {
      return deriveLegalHoldView(hold); // idempotent
    }

    const releasedAt = new Date();
    const res = await this.repo.release(id, releasedAt);
    if (res.count === 0) {
      const now = await this.load(id);
      if (now.releasedAt !== null) {
        return deriveLegalHoldView(now); // concurrent release landed first
      }
      throw new ConflictException(
        `Legal Hold ${id} changed concurrently — reload and retry.`,
      );
    }

    await this.resolveSlaTimerBestEffort(id, actorUserId);

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- helpers -------------------------------------------------

  private async load(id: string): Promise<LegalHoldRow> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Legal Hold ${id} not found.`);
    }
    return row;
  }

  private async startSlaTimerBestEffort(
    id: string,
    dueAt: Date,
    actorUserId: string,
  ): Promise<boolean> {
    try {
      await this.slaTimer.startTimer({
        entityType: 'LegalHold',
        entityId: id,
        workflowName: LEGAL_HOLD_REVIEW_SLA_WORKFLOW,
        dueAt,
        actorUserId,
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `LegalHold ${id}: failed to start its review SLA timer: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async resolveSlaTimerBestEffort(
    id: string,
    actorUserId: string,
    createdBefore?: Date,
  ): Promise<void> {
    try {
      await this.slaTimer.resolve({
        entityType: 'LegalHold',
        entityId: id,
        workflowName: LEGAL_HOLD_REVIEW_SLA_WORKFLOW,
        actorUserId,
        createdBefore,
      });
    } catch (err) {
      this.logger.warn(
        `LegalHold ${id}: failed to resolve its review SLA timer (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  private async reloadAndAuditUpdate(
    id: string,
    actorUserId: string,
  ): Promise<LegalHoldView> {
    const after = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'LegalHold',
      entityId: after.id,
      afterValue: legalHoldAuditSnapshot(after),
    });
    return deriveLegalHoldView(after);
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `LegalHold audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
