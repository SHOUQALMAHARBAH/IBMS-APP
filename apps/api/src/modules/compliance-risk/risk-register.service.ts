import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { RiskRegisterRepository } from '../../repositories/risk-register.repository';
import {
  deriveRiskRegisterItemView,
  riskRegisterItemAuditSnapshot,
  RISK_REGISTER_READ_LIMIT,
  type RiskRegisterItemRow,
  type RiskRegisterItemView,
} from './risk-register.config';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import type { CreateRiskRegisterItemDto } from './dto/create-risk-register-item.dto';
import type { UpdateRiskRegisterMitigationDto } from './dto/update-risk-register-mitigation.dto';
import type { ListRiskRegisterQueryDto } from './dto/list-risk-register-query.dto';

/**
 * Process 53 — the broker's own operational/cyber/financial/compliance/
 * reputational risk register. `risk-register.manage`
 * (`[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER]`) is the sole gate on
 * every route — book-wide, the #41/#44/#45 "one permission for CRUD" shape.
 */
@Injectable()
export class RiskRegisterService {
  private readonly logger = new Logger(RiskRegisterService.name);

  constructor(
    private readonly repo: RiskRegisterRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateRiskRegisterItemDto,
    actorUserId: string,
  ): Promise<RiskRegisterItemView> {
    const loggedAt = dto.loggedAt
      ? parseHistoricalInstant(dto.loggedAt, 'loggedAt')
      : new Date();

    const row = await this.repo.create({
      riskType: dto.riskType,
      description: dto.description,
      mitigationAction: dto.mitigationAction ?? null,
      loggedAt,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'RiskRegisterItem',
      entityId: row.id,
      afterValue: riskRegisterItemAuditSnapshot(row),
    });

    return deriveRiskRegisterItemView(row);
  }

  async recordMitigation(
    id: string,
    dto: UpdateRiskRegisterMitigationDto,
    actorUserId: string,
  ): Promise<RiskRegisterItemView> {
    const item = await this.mustFind(id);
    if (item.status !== 'open') {
      throw new ConflictException(
        `Risk register item ${id} is ${item.status} — its mitigation plan can only be updated while open.`,
      );
    }

    const res = await this.repo.recordMitigation(id, dto.mitigationAction);
    if (res.count === 0) {
      throw new ConflictException(
        `Risk register item ${id} changed concurrently — reload and retry.`,
      );
    }

    const after = await this.mustFind(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RiskRegisterItem',
      entityId: after.id,
      afterValue: riskRegisterItemAuditSnapshot(after),
    });
    return deriveRiskRegisterItemView(after);
  }

  /** `open -> closed`, idempotent on an already-closed item (the
   * `RetentionCase.close` shape). */
  async close(id: string, actorUserId: string): Promise<RiskRegisterItemView> {
    const item = await this.mustFind(id);
    if (item.status === 'closed') {
      return deriveRiskRegisterItemView(item);
    }

    const res = await this.repo.close(id, new Date());
    const after = await this.mustFind(id);
    if (res.count > 0) {
      await this.safeAudit({
        userId: actorUserId,
        action: 'UPDATE',
        entityType: 'RiskRegisterItem',
        entityId: after.id,
        afterValue: riskRegisterItemAuditSnapshot(after),
      });
    }
    return deriveRiskRegisterItemView(after);
  }

  async get(id: string): Promise<RiskRegisterItemView> {
    return deriveRiskRegisterItemView(await this.mustFind(id));
  }

  async list(query: ListRiskRegisterQueryDto): Promise<RiskRegisterItemView[]> {
    const rows = await this.repo.findMany(
      { riskType: query.riskType, status: query.status },
      RISK_REGISTER_READ_LIMIT,
    );
    if (rows.length >= RISK_REGISTER_READ_LIMIT) {
      this.logger.warn(
        `Risk register list truncated at ${RISK_REGISTER_READ_LIMIT} rows — narrow with riskType / status.`,
      );
    }
    return rows.map(deriveRiskRegisterItemView);
  }

  private async mustFind(id: string): Promise<RiskRegisterItemRow> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Risk register item ${id} not found.`);
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Risk-register audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
