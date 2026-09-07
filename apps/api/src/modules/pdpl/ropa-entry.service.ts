import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { RopaEntryRepository } from '../../repositories/ropa-entry.repository';
import {
  deriveRopaEntryView,
  ropaEntryAuditSnapshot,
  ropaExportAuditSnapshot,
  type RopaEntryView,
  type RopaExportSummary,
} from './ropa-entry.config';
import type { CreateRopaEntryDto } from './dto/create-ropa-entry.dto';
import type { UpdateRopaEntryDto } from './dto/update-ropa-entry.dto';

const DEFAULT_LIST_TAKE = 1000;

/** Records of Processing Activities (Part 9.3). `ropa.manage` (DPO-only)
 * gates the whole surface. */
@Injectable()
export class RopaEntryService {
  private readonly logger = new Logger(RopaEntryService.name);

  constructor(
    private readonly repo: RopaEntryRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateRopaEntryDto,
    actorUserId: string,
  ): Promise<RopaEntryView> {
    const row = await this.repo.create({
      processingActivity: dto.processingActivity,
      categoriesOfData: dto.categoriesOfData,
      purpose: dto.purpose,
      recipients: dto.recipients,
      retentionPeriodMonths: dto.retentionPeriodMonths ?? null,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'RopaEntry',
      entityId: row.id,
      afterValue: ropaEntryAuditSnapshot(row),
    });

    return deriveRopaEntryView(row);
  }

  async get(id: string): Promise<RopaEntryView> {
    return deriveRopaEntryView(await this.load(id));
  }

  async list(): Promise<RopaEntryView[]> {
    const rows = await this.repo.findMany(DEFAULT_LIST_TAKE);
    return rows.map((r) => deriveRopaEntryView(r));
  }

  async update(
    id: string,
    dto: UpdateRopaEntryDto,
    actorUserId: string,
  ): Promise<RopaEntryView> {
    await this.load(id);
    const row = await this.repo.update(id, {
      processingActivity: dto.processingActivity,
      categoriesOfData: dto.categoriesOfData,
      purpose: dto.purpose,
      recipients: dto.recipients,
      retentionPeriodMonths: dto.retentionPeriodMonths,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RopaEntry',
      entityId: row.id,
      afterValue: ropaEntryAuditSnapshot(row),
    });

    return deriveRopaEntryView(row);
  }

  /** The #65 Strategic Planning Inputs precedent — an `EXPORT` audit row
   * with a synthetic entityId, since there is no single row being
   * exported. */
  async export(actorUserId: string): Promise<RopaExportSummary> {
    const rows = await this.repo.findMany(DEFAULT_LIST_TAKE);
    const summary: RopaExportSummary = {
      generatedAt: new Date().toISOString(),
      entryCount: rows.length,
      entries: rows.map((r) => deriveRopaEntryView(r)),
    };

    await this.safeAudit({
      userId: actorUserId,
      action: 'EXPORT',
      entityType: 'RopaEntry',
      entityId: 'ropa-register',
      afterValue: ropaExportAuditSnapshot(summary),
    });

    return summary;
  }

  private async load(id: string) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`RoPA entry ${id} not found.`);
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `RopaEntry audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
