import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { DataProcessingAgreement } from '@ibms/db';
import { DataProcessingAgreementRepository } from '../../repositories/data-processing-agreement.repository';
import { VendorRepository } from '../../repositories/vendor.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { assertDifferentActors } from '../../common/maker-checker.util';

/** Process 71 (backlog Part C #71, Domain H) — `DataProcessingAgreement`'s
 * first real writer. The maker (`assessedByUserId`, this module's own
 * `vendor.manage`) and checker (`dpoApprovedByUserId`, `dpa.approve`)
 * are two DISTINCT pre-seeded permission codes — the maker-checker
 * default, already anticipated by the DB `CHECK` constraint added in the
 * A.5 foundational work. */
@Injectable()
export class DataProcessingAgreementService {
  private readonly logger = new Logger(DataProcessingAgreementService.name);

  constructor(
    private readonly dpas: DataProcessingAgreementRepository,
    private readonly vendors: VendorRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    vendorId: string,
    actorUserId: string,
  ): Promise<DataProcessingAgreement> {
    const vendor = await this.vendors.findById(vendorId);
    if (!vendor) throw new NotFoundException('Vendor not found');

    const dpa = await this.dpas.create({
      vendorId,
      assessedByUserId: actorUserId,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'DataProcessingAgreement',
      entityId: dpa.id,
      afterValue: { vendorId, assessedByUserId: actorUserId },
    });

    return dpa;
  }

  async listByVendor(vendorId: string): Promise<DataProcessingAgreement[]> {
    const vendor = await this.vendors.findById(vendorId);
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.dpas.findByVendorId(vendorId);
  }

  async sign(
    id: string,
    actorUserId: string,
  ): Promise<DataProcessingAgreement> {
    const existing = await this.dpas.findById(id);
    if (!existing)
      throw new NotFoundException('Data Processing Agreement not found');

    const now = new Date();
    const signed = await this.dpas.sign(id, now);
    if (!signed) {
      throw new ConflictException(
        `Data Processing Agreement ${id} has already been signed.`,
      );
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'DataProcessingAgreement',
      entityId: id,
      afterValue: { signedAt: now.toISOString() },
    });

    return signed;
  }

  /** `dpa.approve` (DPO only) — the checker step. `assertDifferentActors`
   * is the application-layer backstop; `DataProcessingAgreement_
   * maker_checker_distinct` is the DB one. */
  async dpoApprove(
    id: string,
    actorUserId: string,
  ): Promise<DataProcessingAgreement> {
    const existing = await this.dpas.findById(id);
    if (!existing)
      throw new NotFoundException('Data Processing Agreement not found');

    assertDifferentActors(
      existing.assessedByUserId ?? '',
      actorUserId,
      'DataProcessingAgreement.dpoApprove',
    );

    const approved = await this.dpas.dpoApprove(id, actorUserId);
    if (!approved) {
      throw new ConflictException(
        `Data Processing Agreement ${id} has already been DPO-approved.`,
      );
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'DataProcessingAgreement',
      entityId: id,
      afterValue: { dpoApprovedByUserId: actorUserId },
      isSensitiveDataAccess: true,
    });

    return approved;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `DataProcessingAgreement audit (${input.action} ${input.entityId}) failed: ${(err as Error).message}`,
      );
    }
  }
}
