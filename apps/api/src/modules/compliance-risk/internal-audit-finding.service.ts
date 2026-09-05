import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { InternalAuditFindingRepository } from '../../repositories/internal-audit-finding.repository';
import {
  deriveInternalAuditFindingView,
  internalAuditFindingAuditSnapshot,
  INTERNAL_AUDIT_FINDING_READ_LIMIT,
  type InternalAuditFindingRow,
  type InternalAuditFindingView,
} from './internal-audit-finding.config';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import type { CreateInternalAuditFindingDto } from './dto/create-internal-audit-finding.dto';
import type { UpdateInternalAuditFindingRemediationDto } from './dto/update-internal-audit-finding-remediation.dto';
import type { ListInternalAuditFindingQueryDto } from './dto/list-internal-audit-finding-query.dto';

/**
 * Process 57 — the internal audit findings and remediation tracker.
 * `internal-audit.record` (`[COMPLIANCE_OFFICER]`) gates recording a
 * finding and updating its remediation plan; `internal-audit.close`
 * (`[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER]`) gates closure — two
 * distinct permissions, not a maker/checker pair (the model carries no
 * maker/checker columns at all; `assertDifferentActors` does not apply
 * here, the same way it does not for `RiskRegisterItem`).
 */
@Injectable()
export class InternalAuditFindingService {
  private readonly logger = new Logger(InternalAuditFindingService.name);

  constructor(
    private readonly repo: InternalAuditFindingRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateInternalAuditFindingDto,
    actorUserId: string,
  ): Promise<InternalAuditFindingView> {
    const loggedAt = dto.loggedAt
      ? parseHistoricalInstant(dto.loggedAt, 'loggedAt')
      : new Date();

    const row = await this.repo.create({
      auditPeriodLabel: dto.auditPeriodLabel,
      finding: dto.finding,
      remediationAction: dto.remediationAction ?? null,
      loggedAt,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'InternalAuditFinding',
      entityId: row.id,
      afterValue: internalAuditFindingAuditSnapshot(row),
    });

    return deriveInternalAuditFindingView(row);
  }

  async recordRemediation(
    id: string,
    dto: UpdateInternalAuditFindingRemediationDto,
    actorUserId: string,
  ): Promise<InternalAuditFindingView> {
    const item = await this.mustFind(id);
    if (item.status !== 'open') {
      throw new ConflictException(
        `Internal audit finding ${id} is ${item.status} — its remediation plan can only be updated while open.`,
      );
    }

    const res = await this.repo.recordRemediation(id, dto.remediationAction);
    if (res.count === 0) {
      throw new ConflictException(
        `Internal audit finding ${id} changed concurrently — reload and retry.`,
      );
    }

    const after = await this.mustFind(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'InternalAuditFinding',
      entityId: after.id,
      afterValue: internalAuditFindingAuditSnapshot(after),
    });
    return deriveInternalAuditFindingView(after);
  }

  /** `open -> closed`, idempotent on an already-closed finding (the
   * `RiskRegisterItem.close` shape). */
  async close(
    id: string,
    actorUserId: string,
  ): Promise<InternalAuditFindingView> {
    const item = await this.mustFind(id);
    if (item.status === 'closed') {
      return deriveInternalAuditFindingView(item);
    }

    const res = await this.repo.close(id, new Date());
    const after = await this.mustFind(id);
    if (res.count > 0) {
      await this.safeAudit({
        userId: actorUserId,
        action: 'UPDATE',
        entityType: 'InternalAuditFinding',
        entityId: after.id,
        afterValue: internalAuditFindingAuditSnapshot(after),
      });
    }
    return deriveInternalAuditFindingView(after);
  }

  async get(id: string): Promise<InternalAuditFindingView> {
    return deriveInternalAuditFindingView(await this.mustFind(id));
  }

  async list(
    query: ListInternalAuditFindingQueryDto,
  ): Promise<InternalAuditFindingView[]> {
    const rows = await this.repo.findMany(
      { status: query.status },
      INTERNAL_AUDIT_FINDING_READ_LIMIT,
    );
    if (rows.length >= INTERNAL_AUDIT_FINDING_READ_LIMIT) {
      this.logger.warn(
        `Internal audit finding list truncated at ${INTERNAL_AUDIT_FINDING_READ_LIMIT} rows — narrow with status.`,
      );
    }
    return rows.map(deriveInternalAuditFindingView);
  }

  private async mustFind(id: string): Promise<InternalAuditFindingRow> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Internal audit finding ${id} not found.`);
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Internal-audit-finding audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
