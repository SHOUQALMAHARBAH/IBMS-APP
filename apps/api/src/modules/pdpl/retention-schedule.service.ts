import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type RetentionScheduleItem } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { RetentionScheduleRepository } from '../../repositories/retention-schedule.repository';
import {
  deriveRetentionScheduleItemView,
  retentionScheduleItemAuditSnapshot,
  type RetentionScheduleItemView,
} from './retention-schedule.config';
import type { CreateRetentionScheduleItemDto } from './dto/create-retention-schedule-item.dto';
import type { UpdateRetentionScheduleItemDto } from './dto/update-retention-schedule-item.dto';

const P2002 = 'P2002';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
  );
}

/**
 * M06 — Data Retention (backlog Part D §5.1, Process #52). Maintains the
 * retention-period table `RetentionScheduleItem` — one row per record
 * category, pending Legal Counsel confirmation
 * (`retention-schedule.config.ts`'s header comment). `retention-
 * schedule.manage` (`[COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER]`) gates
 * the whole surface — this is the first PDPL/Domain-H-adjacent item this
 * session where no permission was pre-seeded ahead of time for the
 * SCHEDULE itself (only the disposal/legal-hold actions were).
 */
@Injectable()
export class RetentionScheduleService {
  private readonly logger = new Logger(RetentionScheduleService.name);

  constructor(
    private readonly repo: RetentionScheduleRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateRetentionScheduleItemDto,
    actorUserId: string,
  ): Promise<RetentionScheduleItemView> {
    let row: RetentionScheduleItem;
    try {
      row = await this.repo.create({
        recordCategory: dto.recordCategory,
        retentionPeriodMonths: dto.retentionPeriodMonths,
        legalBasis: dto.legalBasis ?? null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A retention-schedule item for record category "${dto.recordCategory}" already exists.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'RetentionScheduleItem',
      entityId: row.id,
      afterValue: retentionScheduleItemAuditSnapshot(row),
    });

    return deriveRetentionScheduleItemView(row);
  }

  async get(id: string): Promise<RetentionScheduleItemView> {
    return deriveRetentionScheduleItemView(await this.load(id));
  }

  async list(): Promise<RetentionScheduleItemView[]> {
    const rows = await this.repo.findMany();
    return rows.map((r) => deriveRetentionScheduleItemView(r));
  }

  /** Only pre-confirmation — an already-confirmed row is a settled legal
   * record, not an editable draft (the model's own `confirmedByLegalCounselAt`
   * gate). Add a NEW category row instead of editing a confirmed one. */
  async update(
    id: string,
    dto: UpdateRetentionScheduleItemDto,
    actorUserId: string,
  ): Promise<RetentionScheduleItemView> {
    const item = await this.load(id);
    if (item.confirmedByLegalCounselAt !== null) {
      throw new UnprocessableEntityException(
        `Retention schedule item ${id} is already confirmed by Legal Counsel — it is no longer editable. Add a new item instead.`,
      );
    }

    const row = await this.repo.update(id, {
      retentionPeriodMonths: dto.retentionPeriodMonths,
      legalBasis: dto.legalBasis,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RetentionScheduleItem',
      entityId: row.id,
      afterValue: retentionScheduleItemAuditSnapshot(row),
    });

    return deriveRetentionScheduleItemView(row);
  }

  /** A one-time legal act, not a toggle — 422s if already confirmed. */
  async confirm(
    id: string,
    actorUserId: string,
  ): Promise<RetentionScheduleItemView> {
    await this.load(id);
    const confirmedAt = new Date();
    const res = await this.repo.confirm(id, confirmedAt);
    if (res.count === 0) {
      const now = await this.load(id);
      if (now.confirmedByLegalCounselAt !== null) {
        throw new UnprocessableEntityException(
          `Retention schedule item ${id} is already confirmed by Legal Counsel.`,
        );
      }
      throw new ConflictException(
        `Retention schedule item ${id} changed concurrently — reload and retry.`,
      );
    }

    const row = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RetentionScheduleItem',
      entityId: row.id,
      afterValue: retentionScheduleItemAuditSnapshot(row),
    });
    return deriveRetentionScheduleItemView(row);
  }

  private async load(id: string) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Retention schedule item ${id} not found.`);
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `RetentionScheduleItem audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
