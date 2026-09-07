import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { SlaTimerService } from '../sla/sla-timer.service';
import { assertDifferentActors } from '../../common/maker-checker.util';
import { assertSecureChannel } from '../security/secure-channel.util';
import { DataSharingApprovalRepository } from '../../repositories/data-sharing-approval.repository';
import { VendorRepository } from '../../repositories/vendor.repository';
import { DataProcessingAgreementRepository } from '../../repositories/data-processing-agreement.repository';
import { computeDataShareReadiness } from '../supporting-operations/vendor.config';
import {
  DATA_SHARING_SLA_WORKFLOW,
  dataSharingApprovalAuditSnapshot,
  deriveDataSharingApprovalView,
  type DataSharingApprovalView,
} from './data-sharing-approval.config';
import type { CreateDataSharingApprovalDto } from './dto/create-data-sharing-approval.dto';
import type { ListDataSharingApprovalsQueryDto } from './dto/list-data-sharing-approvals-query.dto';

const DEFAULT_LIST_TAKE = 200;

/**
 * M08 — Third Parties & Data Sharing. `data-sharing.request` (the maker,
 * broad) gates `create()`; `data-sharing.approve` (DPO, the checker) gates
 * `approve()`/`decline()`. See `data-sharing-approval.config.ts`'s header
 * comment for the risk-tiering wiring, the regulatory-channel exemption,
 * and the approve-vs-decline shape.
 */
@Injectable()
export class DataSharingApprovalService {
  private readonly logger = new Logger(DataSharingApprovalService.name);

  constructor(
    private readonly repo: DataSharingApprovalRepository,
    private readonly vendors: VendorRepository,
    private readonly dpas: DataProcessingAgreementRepository,
    private readonly slaTimer: SlaTimerService,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateDataSharingApprovalDto,
    actorUserId: string,
  ): Promise<DataSharingApprovalView> {
    assertSecureChannel(dto.classification, dto.channel);

    const isRegulatoryChannel = dto.isRegulatoryChannel ?? false;

    if (dto.vendorId) {
      const vendor = await this.vendors.findById(dto.vendorId);
      if (!vendor) {
        throw new NotFoundException(`Vendor ${dto.vendorId} not found.`);
      }
      // "regulatory channels ... are exempt from the standard vendor-risk
      // assessment" — the exemption is scoped to THIS check only; the
      // classification/channel check above always runs.
      if (!isRegulatoryChannel) {
        const activeDpa = await this.dpas.findActiveByVendorId(dto.vendorId);
        const readiness = computeDataShareReadiness(
          dto.vendorId,
          vendor.riskTier,
          activeDpa
            ? {
                id: activeDpa.id,
                signedAt: activeDpa.signedAt,
                dpoApprovedByUserId: activeDpa.dpoApprovedByUserId,
              }
            : null,
        );
        if (!readiness.ready) {
          throw new UnprocessableEntityException(
            `Vendor is not ready for a data share: ${readiness.reasons.join('; ')}`,
          );
        }
      }
    }

    const now = new Date();
    const slaDueAt = this.slaTimer.computeDueAt(
      DATA_SHARING_SLA_WORKFLOW,
      now,
      { regulatoryChannel: isRegulatoryChannel },
    );

    const row = await this.repo.create({
      vendorId: dto.vendorId ?? null,
      description: dto.description,
      classification: dto.classification,
      channel: dto.channel,
      isRegulatoryChannel,
      requestedByUserId: actorUserId,
      slaDueAt,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'DataSharingApproval',
      entityId: row.id,
      afterValue: dataSharingApprovalAuditSnapshot(row),
      isSensitiveDataAccess: true,
    });

    await this.slaTimer.startTimer({
      entityType: 'DataSharingApproval',
      entityId: row.id,
      workflowName: DATA_SHARING_SLA_WORKFLOW,
      dueAt: slaDueAt,
      actorUserId,
    });

    return deriveDataSharingApprovalView(row);
  }

  async get(id: string): Promise<DataSharingApprovalView> {
    return deriveDataSharingApprovalView(await this.load(id));
  }

  async list(
    query: ListDataSharingApprovalsQueryDto,
  ): Promise<DataSharingApprovalView[]> {
    const rows = await this.repo.findMany(
      {
        vendorId: query.vendorId,
        classification: query.classification,
        pendingOnly: query.pendingOnly,
      },
      DEFAULT_LIST_TAKE,
    );
    return rows.map((r) => deriveDataSharingApprovalView(r));
  }

  async approve(
    id: string,
    actorUserId: string,
  ): Promise<DataSharingApprovalView> {
    const existing = await this.load(id);
    assertDifferentActors(
      existing.requestedByUserId,
      actorUserId,
      'DataSharingApproval.approve',
    );

    const decidedAt = new Date();
    const res = await this.repo.approve(id, actorUserId, decidedAt);
    if (res.count === 0) {
      throw new UnprocessableEntityException(
        `Data sharing request ${id} has already been decided.`,
      );
    }

    const row = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'APPROVE',
      entityType: 'DataSharingApproval',
      entityId: row.id,
      afterValue: dataSharingApprovalAuditSnapshot(row),
      isSensitiveDataAccess: true,
    });
    await this.slaTimer.resolve({
      entityType: 'DataSharingApproval',
      entityId: row.id,
      workflowName: DATA_SHARING_SLA_WORKFLOW,
      actorUserId,
    });

    return deriveDataSharingApprovalView(row);
  }

  /** Leaves `approvedByUserId` null — "reviewed and declined," no
   * maker/checker distinct-actor requirement applies (see this file's
   * config header comment). */
  async decline(
    id: string,
    actorUserId: string,
  ): Promise<DataSharingApprovalView> {
    await this.load(id);
    const decidedAt = new Date();
    const res = await this.repo.decline(id, decidedAt);
    if (res.count === 0) {
      throw new UnprocessableEntityException(
        `Data sharing request ${id} has already been decided.`,
      );
    }

    const row = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'REJECT',
      entityType: 'DataSharingApproval',
      entityId: row.id,
      afterValue: dataSharingApprovalAuditSnapshot(row),
      isSensitiveDataAccess: true,
    });
    await this.slaTimer.resolve({
      entityType: 'DataSharingApproval',
      entityId: row.id,
      workflowName: DATA_SHARING_SLA_WORKFLOW,
      actorUserId,
    });

    return deriveDataSharingApprovalView(row);
  }

  private async load(id: string) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Data sharing request ${id} not found.`);
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `DataSharingApproval audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
