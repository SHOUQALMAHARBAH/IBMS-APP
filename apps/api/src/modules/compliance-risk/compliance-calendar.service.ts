import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { ComplianceCalendarRepository } from '../../repositories/compliance-calendar.repository';
import {
  complianceCalendarItemAuditSnapshot,
  deriveComplianceCalendarItemView,
  COMPLIANCE_CALENDAR_READ_LIMIT,
  type ComplianceCalendarItemView,
} from './compliance-calendar.config';
import { parseCalendarDate } from '../../common/calendar-date.util';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import type { CreateComplianceCalendarItemDto } from './dto/create-compliance-calendar-item.dto';
import type { RecordComplianceSubmissionDto } from './dto/record-compliance-submission.dto';
import type { ListComplianceCalendarQueryDto } from './dto/list-compliance-calendar-query.dto';

/**
 * Process 51/Part 7.1 — the CBJ regulatory compliance calendar (backlog
 * Part C #51's second checkbox). `compliance-calendar.manage`
 * (`[COMPLIANCE_OFFICER]`) is the sole gate on every route — book-wide, the
 * #41/#44/#45 shape. Not a `WorkflowTransitionService` entity, no
 * maker/checker, no `SlaTimer` — a factual log, create + one submission
 * stamp + read.
 */
@Injectable()
export class ComplianceCalendarService {
  private readonly logger = new Logger(ComplianceCalendarService.name);

  constructor(
    private readonly repo: ComplianceCalendarRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateComplianceCalendarItemDto,
    actorUserId: string,
  ): Promise<ComplianceCalendarItemView> {
    if (!(await this.repo.userExists(dto.ownerUserId))) {
      throw new NotFoundException(`User ${dto.ownerUserId} not found.`);
    }
    const dueDate = parseCalendarDate(dto.dueDate, 'dueDate');

    const row = await this.repo.create({
      obligationName: dto.obligationName,
      ownerUserId: dto.ownerUserId,
      dueDate,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'ComplianceCalendarItem',
      entityId: row.id,
      afterValue: complianceCalendarItemAuditSnapshot(row),
    });

    return deriveComplianceCalendarItemView(row, new Date());
  }

  /** Write-once — 409 if this item's submission was already recorded (the
   * `Retention Case close` idempotent shape doesn't apply here: unlike a
   * status re-close, silently accepting a second submission would let a
   * later call overwrite the first evidence reference with no audit trail
   * of the original). `submittedAt` defaults to now, backdatable via
   * `parseHistoricalInstant` (the #10/#12/#44/#45 helper) for recording a
   * filing that already happened. */
  async recordSubmission(
    id: string,
    dto: RecordComplianceSubmissionDto,
    actorUserId: string,
  ): Promise<ComplianceCalendarItemView> {
    await this.mustFind(id);
    const submittedAt = dto.submittedAt
      ? parseHistoricalInstant(dto.submittedAt, 'submittedAt')
      : new Date();

    const res = await this.repo.recordSubmission(
      id,
      dto.evidenceOfSubmissionRef,
      submittedAt,
    );
    if (res.count === 0) {
      throw new ConflictException(
        `Compliance calendar item ${id} already has a recorded submission.`,
      );
    }

    const after = await this.mustFind(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'ComplianceCalendarItem',
      entityId: after.id,
      afterValue: complianceCalendarItemAuditSnapshot(after),
    });
    return deriveComplianceCalendarItemView(after, new Date());
  }

  async get(id: string): Promise<ComplianceCalendarItemView> {
    return deriveComplianceCalendarItemView(
      await this.mustFind(id),
      new Date(),
    );
  }

  async list(
    query: ListComplianceCalendarQueryDto,
  ): Promise<ComplianceCalendarItemView[]> {
    const now = new Date();
    const rows = await this.repo.findMany(
      { ownerUserId: query.ownerUserId, overdueOnly: query.overdueOnly },
      now,
      COMPLIANCE_CALENDAR_READ_LIMIT,
    );
    if (rows.length >= COMPLIANCE_CALENDAR_READ_LIMIT) {
      this.logger.warn(
        `Compliance-calendar list truncated at ${COMPLIANCE_CALENDAR_READ_LIMIT} rows — narrow with ownerUserId / overdueOnly.`,
      );
    }
    return rows.map((r) => deriveComplianceCalendarItemView(r, now));
  }

  private async mustFind(id: string) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Compliance calendar item ${id} not found.`);
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Compliance-calendar audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
