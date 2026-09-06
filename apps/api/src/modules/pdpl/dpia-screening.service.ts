import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { SlaTimerService } from '../sla/sla-timer.service';
import { DpiaScreeningRepository } from '../../repositories/dpia-screening.repository';
import {
  DPIA_REVIEW_SLA_WORKFLOW,
  computeDpiaOutcome,
  deriveDpiaScreeningView,
  dpiaScreeningAuditSnapshot,
  type DpiaScreeningView,
} from './dpia-screening.config';
import type { CreateDpiaScreeningDto } from './dto/create-dpia-screening.dto';
import type { ListDpiaScreeningsQueryDto } from './dto/list-dpia-screenings-query.dto';

const DEFAULT_LIST_TAKE = 200;

/** M10 — DPIA Screening. `dpia.review` (DPO-only) gates the whole surface
 * — see `dpia-screening.config.ts`'s header comment. */
@Injectable()
export class DpiaScreeningService {
  private readonly logger = new Logger(DpiaScreeningService.name);

  constructor(
    private readonly repo: DpiaScreeningRepository,
    private readonly slaTimer: SlaTimerService,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateDpiaScreeningDto,
    actorUserId: string,
  ): Promise<DpiaScreeningView> {
    const outcome = computeDpiaOutcome(dto);
    const now = new Date();
    const dpoReviewDueAt =
      outcome === 'DPO_REVIEW_REQUIRED'
        ? this.slaTimer.computeDueAt(DPIA_REVIEW_SLA_WORKFLOW, now)
        : null;

    const row = await this.repo.create({
      subjectDescription: dto.subjectDescription,
      qSensitiveData: dto.qSensitiveData,
      qLargeScaleProcessing: dto.qLargeScaleProcessing,
      qCrossBorderTransfer: dto.qCrossBorderTransfer,
      qNewTechnologyMonitoring: dto.qNewTechnologyMonitoring,
      qNewDigitalChannel: dto.qNewDigitalChannel,
      outcome,
      dpoReviewDueAt,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'DpiaScreening',
      entityId: row.id,
      afterValue: dpiaScreeningAuditSnapshot(row),
    });

    if (dpoReviewDueAt) {
      await this.slaTimer.startTimer({
        entityType: 'DpiaScreening',
        entityId: row.id,
        workflowName: DPIA_REVIEW_SLA_WORKFLOW,
        dueAt: dpoReviewDueAt,
        actorUserId,
      });
    }

    return deriveDpiaScreeningView(row);
  }

  async get(id: string): Promise<DpiaScreeningView> {
    return deriveDpiaScreeningView(await this.load(id));
  }

  async list(query: ListDpiaScreeningsQueryDto): Promise<DpiaScreeningView[]> {
    const rows = await this.repo.findMany(
      { outcome: query.outcome },
      DEFAULT_LIST_TAKE,
    );
    return rows.map((r) => deriveDpiaScreeningView(r));
  }

  /** Completes an ordinary review — outcome stays DPO_REVIEW_REQUIRED,
   * just annotated as reviewed. Resolves the SLA timer. */
  async recordReview(
    id: string,
    actorUserId: string,
  ): Promise<DpiaScreeningView> {
    await this.load(id);
    const dpoReviewedAt = new Date();
    const res = await this.repo.recordReview(id, dpoReviewedAt);
    if (res.count === 0) {
      throw new UnprocessableEntityException(
        `DPIA screening ${id} is not awaiting review (already reviewed, escalated, or auto-approved).`,
      );
    }

    const row = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'DpiaScreening',
      entityId: row.id,
      afterValue: dpiaScreeningAuditSnapshot(row),
    });
    await this.slaTimer.resolve({
      entityType: 'DpiaScreening',
      entityId: row.id,
      workflowName: DPIA_REVIEW_SLA_WORKFLOW,
      actorUserId,
    });

    return deriveDpiaScreeningView(row);
  }

  /** Un-timed quality-assurance stamp on an AUTO_APPROVED result — no SLA. */
  async recordSpotCheck(
    id: string,
    actorUserId: string,
  ): Promise<DpiaScreeningView> {
    await this.load(id);
    const res = await this.repo.recordSpotCheck(id, new Date());
    if (res.count === 0) {
      throw new UnprocessableEntityException(
        `DPIA screening ${id} is not an unspot-checked AUTO_APPROVED result.`,
      );
    }

    const row = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'DpiaScreening',
      entityId: row.id,
      afterValue: dpiaScreeningAuditSnapshot(row),
    });

    return deriveDpiaScreeningView(row);
  }

  /** The one real outcome move: DPO_REVIEW_REQUIRED -> ESCALATED_FULL_DPIA,
   * a manual DPO judgment call for a "materially high-risk" case — no
   * automatic threshold (see this file's config header comment). Mutually
   * exclusive with recordReview(). */
  async escalateToFullDpia(
    id: string,
    actorUserId: string,
  ): Promise<DpiaScreeningView> {
    await this.load(id);
    const escalatedToFullDpiaAt = new Date();
    const res = await this.repo.escalateToFullDpia(id, escalatedToFullDpiaAt);
    if (res.count === 0) {
      throw new UnprocessableEntityException(
        `DPIA screening ${id} cannot be escalated (not awaiting review, already reviewed, or already escalated).`,
      );
    }

    const row = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'DpiaScreening',
      entityId: row.id,
      afterValue: dpiaScreeningAuditSnapshot(row),
    });
    await this.slaTimer.resolve({
      entityType: 'DpiaScreening',
      entityId: row.id,
      workflowName: DPIA_REVIEW_SLA_WORKFLOW,
      actorUserId,
    });

    return deriveDpiaScreeningView(row);
  }

  private async load(id: string) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`DPIA screening ${id} not found.`);
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `DpiaScreening audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
