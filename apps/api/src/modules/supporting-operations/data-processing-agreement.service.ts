import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DataProcessingAgreementRepository,
  type DataProcessingAgreementWithAct,
} from '../../repositories/data-processing-agreement.repository';
import { VendorRepository } from '../../repositories/vendor.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { DutySegregationService } from '../duty-segregation/duty-segregation.service';
import { UserRepository } from '../../repositories/user.repository';
import type { DpaActorNames } from './vendor.config';

/** Process 71 (backlog Part C #71, Domain H) — `DataProcessingAgreement`'s
 * first real writer. The maker (`assessedByUserId`, this module's own
 * `vendor.update`) and checker (`dpoApprovedByUserId`, `dpa.approve`)
 * are two DISTINCT pre-seeded permission codes — the maker-checker
 * default, already anticipated by the DB `CHECK` constraint added in the
 * A.5 foundational work. */
@Injectable()
export class DataProcessingAgreementService {
  private readonly logger = new Logger(DataProcessingAgreementService.name);

  constructor(
    private readonly dpas: DataProcessingAgreementRepository,
    /** Item 4(a) — decision 48's resolver, the one place that answers "who did this". */
    private readonly users: UserRepository,
    private readonly vendors: VendorRepository,
    private readonly audit: AuditService,
    private readonly dutySegregation: DutySegregationService,
  ) {}

  async create(
    vendorId: string,
    actorUserId: string,
  ): Promise<DataProcessingAgreementWithAct & DpaActorNames> {
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

    return (await this.withNames([dpa]))[0];
  }

  async listByVendor(
    vendorId: string,
  ): Promise<(DataProcessingAgreementWithAct & DpaActorNames)[]> {
    const vendor = await this.vendors.findById(vendorId);
    if (!vendor) throw new NotFoundException('Vendor not found');
    const rows = await this.dpas.findByVendorId(vendorId);
    /* BATCHED — one resolve for the whole register rather than two per row, which is how a
     * vendor with a long agreement history stops loading. */
    return this.withNames(rows);
  }

  async sign(
    id: string,
    actorUserId: string,
  ): Promise<DataProcessingAgreementWithAct & DpaActorNames> {
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

    return (await this.withNames([signed]))[0];
  }

  /** `dpa.approve` (DPO only) — the checker step. `assertDifferentActors`
   * is the application-layer backstop; `DataProcessingAgreement_
   * maker_checker_distinct` is the DB one. */
  async dpoApprove(
    id: string,
    actorUserId: string,
    /** Part 4 — present only when the checker is also the maker in an office that declared COMBINED. */
    combinedDutyReason?: string,
  ): Promise<DataProcessingAgreementWithAct & DpaActorNames> {
    const existing = await this.dpas.findById(id);
    if (!existing)
      throw new NotFoundException('Data Processing Agreement not found');

    const combinedDutyActId = await this.dutySegregation.resolve({
      constraint: 'DataProcessingAgreement_maker_checker_distinct',
      makerId: existing.assessedByUserId ?? '',
      checkerId: actorUserId,
      entityId: id,
      context: 'DataProcessingAgreement.dpoApprove',
      actorUserId,
      reason: combinedDutyReason,
    });

    const approved = await this.dpas.dpoApprove(
      id,
      actorUserId,
      combinedDutyActId,
    );
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

    return (await this.withNames([approved]))[0];
  }

  /**
   * ONE place the four projection paths get their names, so the pair is resolved identically
   * wherever a DPA is returned. Decision 48's resolver takes IDS and is batched; a MISSING key
   * reports NO NAME, never the uuid.
   */
  private async withNames<
    T extends {
      assessedByUserId: string | null;
      dpoApprovedByUserId: string | null;
    },
  >(rows: readonly T[]): Promise<(T & DpaActorNames)[]> {
    const names = await this.users.displayNamesForUserIds(
      rows.flatMap((r) => [r.assessedByUserId, r.dpoApprovedByUserId]),
    );
    return rows.map((r) => ({
      ...r,
      assessedByName: r.assessedByUserId
        ? (names.get(r.assessedByUserId) ?? null)
        : null,
      dpoApprovedByName: r.dpoApprovedByUserId
        ? (names.get(r.dpoApprovedByUserId) ?? null)
        : null,
    }));
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
