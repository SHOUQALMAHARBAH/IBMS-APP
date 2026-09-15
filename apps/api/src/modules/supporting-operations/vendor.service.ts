import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Vendor } from '@ibms/db';
import { VendorRepository } from '../../repositories/vendor.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { SlaTimerService } from '../sla/sla-timer.service';
import {
  computeDataShareReadiness,
  VENDOR_ANNUAL_REVIEW_SLA_WORKFLOW,
  VENDOR_TERMINATION_ACCESS_REVOCATION_SLA_WORKFLOW,
  dpaRequiredForTier,
  type DataShareReadiness,
} from './vendor.config';
import type { CreateVendorDto } from './dto/create-vendor.dto';
import type { UpdateVendorDto } from './dto/update-vendor.dto';
import type { ListVendorsQueryDto } from './dto/list-vendors-query.dto';
import type { SetVendorRiskTierDto } from './dto/set-vendor-risk-tier.dto';
import type { TerminateVendorDto } from './dto/terminate-vendor.dto';
import { DataProcessingAgreementRepository } from '../../repositories/data-processing-agreement.repository';

/** Process 67 built the foundational `Vendor` CRUD; Process 71 (backlog
 * Part C #71, Domain H) extends it with risk tiering, the annual-review
 * SLA, termination + access revocation, and the data-share readiness
 * gate. See `vendor.config.ts` for the full design and
 * `ibms-brain/meta/context/vendor-management.md`. */
@Injectable()
export class VendorService {
  private readonly logger = new Logger(VendorService.name);

  constructor(
    private readonly vendors: VendorRepository,
    private readonly dpas: DataProcessingAgreementRepository,
    private readonly slaTimers: SlaTimerService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateVendorDto, actorUserId: string): Promise<Vendor> {
    const vendor = await this.vendors.create({
      name: dto.name,
      vendorType: dto.vendorType,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'Vendor',
      entityId: vendor.id,
      afterValue: { name: vendor.name, vendorType: vendor.vendorType },
    });

    return vendor;
  }

  // Part F item #6 — resolve the search term to a set of ids first, then
  // filter the existing Prisma query by them.
  async list(query: ListVendorsQueryDto): Promise<Vendor[]> {
    return this.vendors.findMany({
      vendorType: query.vendorType,
      id: query.search ? await this.vendors.searchIds(query.search) : undefined,
    });
  }

  async get(id: string): Promise<Vendor> {
    const vendor = await this.vendors.findById(id);
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async update(
    id: string,
    dto: UpdateVendorDto,
    actorUserId: string,
  ): Promise<Vendor> {
    const existing = await this.vendors.findById(id);
    if (!existing) throw new NotFoundException('Vendor not found');

    const updated = await this.vendors.update(id, {
      name: dto.name,
      vendorType: dto.vendorType,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Vendor',
      entityId: id,
      afterValue: { name: updated.name, vendorType: updated.vendorType },
    });

    return updated;
  }

  /** Backlog #71 checkbox 1 — assigns/reassigns the risk tier. The FIRST
   * time a vendor is tiered Medium or High and has no annual review
   * scheduled yet, this also starts the (already-registered,
   * previously-zero-caller) `vendor_annual_review` SLA timer — a tier
   * moved back down to Low does NOT clear an already-scheduled review, a
   * deliberate simplification (see `vendor-management.md`). */
  async setRiskTier(
    id: string,
    dto: SetVendorRiskTierDto,
    actorUserId: string,
  ): Promise<Vendor> {
    const existing = await this.vendors.findById(id);
    if (!existing) throw new NotFoundException('Vendor not found');

    let updated = await this.vendors.setRiskTier(id, dto.riskTier);

    if (dpaRequiredForTier(dto.riskTier) && !existing.annualReviewDueAt) {
      const dueAt = await this.slaTimers.computeDueAt(
        VENDOR_ANNUAL_REVIEW_SLA_WORKFLOW,
        new Date(),
      );
      updated = await this.vendors.scheduleAnnualReview(id, dueAt);
      await this.slaTimers.startTimer({
        entityType: 'Vendor',
        entityId: id,
        workflowName: VENDOR_ANNUAL_REVIEW_SLA_WORKFLOW,
        dueAt,
        actorUserId,
      });
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Vendor',
      entityId: id,
      afterValue: {
        riskTier: updated.riskTier,
        annualReviewDueAt: updated.annualReviewDueAt?.toISOString() ?? null,
      },
    });

    return updated;
  }

  /** Backlog #71 checkbox 3 — records the annual review as done and
   * re-bases the schedule +12 months, resolving the old timer and starting
   * a new one (the `SlaTimerService`-documented re-basing shape). 422s if
   * no review is currently scheduled (the vendor has never been tiered
   * Medium/High). */
  async recordAnnualReview(id: string, actorUserId: string): Promise<Vendor> {
    const existing = await this.vendors.findById(id);
    if (!existing) throw new NotFoundException('Vendor not found');
    if (!existing.annualReviewDueAt) {
      throw new UnprocessableEntityException(
        `Vendor ${id} has no annual review currently scheduled.`,
      );
    }

    const now = new Date();
    await this.slaTimers.resolve({
      entityType: 'Vendor',
      entityId: id,
      workflowName: VENDOR_ANNUAL_REVIEW_SLA_WORKFLOW,
      createdBefore: now,
      actorUserId,
    });
    const dueAt = await this.slaTimers.computeDueAt(
      VENDOR_ANNUAL_REVIEW_SLA_WORKFLOW,
      now,
    );
    const updated = await this.vendors.scheduleAnnualReview(id, dueAt);
    await this.slaTimers.startTimer({
      entityType: 'Vendor',
      entityId: id,
      workflowName: VENDOR_ANNUAL_REVIEW_SLA_WORKFLOW,
      dueAt,
      actorUserId,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Vendor',
      entityId: id,
      afterValue: {
        annualReviewDueAt: updated.annualReviewDueAt?.toISOString() ?? null,
      },
    });

    return updated;
  }

  /** Backlog #71 checkbox 3 — terminates the vendor relationship: the
   * officer must EXPLICITLY confirm data return/destruction
   * (`confirmDataReturnOrDestruction: true`, checked here rather than by
   * `class-validator` — the `FulfilDsrDto` staff-attestation precedent),
   * stamping `terminationDataReturnConfirmedAt` and starting the
   * (newly-registered) `vendor_termination_access_revocation` SLA timer
   * (2 business days). Status-conditional — 409s a second termination. */
  async terminate(
    id: string,
    dto: TerminateVendorDto,
    actorUserId: string,
  ): Promise<Vendor> {
    const existing = await this.vendors.findById(id);
    if (!existing) throw new NotFoundException('Vendor not found');
    if (!dto.confirmDataReturnOrDestruction) {
      throw new UnprocessableEntityException(
        'Terminating a vendor requires an explicit confirmDataReturnOrDestruction: true attestation.',
      );
    }
    if (existing.terminationDataReturnConfirmedAt) {
      throw new ConflictException(`Vendor ${id} has already been terminated.`);
    }

    const now = new Date();
    const updated = await this.vendors.terminate(id, now);
    if (!updated) {
      throw new ConflictException(`Vendor ${id} has already been terminated.`);
    }

    const dueAt = await this.slaTimers.computeDueAt(
      VENDOR_TERMINATION_ACCESS_REVOCATION_SLA_WORKFLOW,
      now,
    );
    await this.slaTimers.startTimer({
      entityType: 'Vendor',
      entityId: id,
      workflowName: VENDOR_TERMINATION_ACCESS_REVOCATION_SLA_WORKFLOW,
      dueAt,
      actorUserId,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Vendor',
      entityId: id,
      afterValue: {
        terminationDataReturnConfirmedAt: now.toISOString(),
      },
    });

    return updated;
  }

  /** Backlog #71 checkbox 3's second half — access revocation, which must
   * follow termination. Status-conditional — 409s a second revocation. */
  async revokeAccess(id: string, actorUserId: string): Promise<Vendor> {
    const existing = await this.vendors.findById(id);
    if (!existing) throw new NotFoundException('Vendor not found');
    if (!existing.terminationDataReturnConfirmedAt) {
      throw new UnprocessableEntityException(
        `Vendor ${id} has not been terminated yet — call terminate first.`,
      );
    }
    if (existing.accessRevokedAt) {
      throw new ConflictException(
        `Vendor ${id}'s access has already been revoked.`,
      );
    }

    const now = new Date();
    const updated = await this.vendors.revokeAccess(id, now);
    if (!updated) {
      throw new ConflictException(
        `Vendor ${id}'s access has already been revoked.`,
      );
    }

    await this.slaTimers.resolve({
      entityType: 'Vendor',
      entityId: id,
      workflowName: VENDOR_TERMINATION_ACCESS_REVOCATION_SLA_WORKFLOW,
      actorUserId,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Vendor',
      entityId: id,
      afterValue: { accessRevokedAt: now.toISOString() },
    });

    return updated;
  }

  /** Backlog #71 checkbox 1 — a queryable readiness check, not a live
   * gate (see `vendor.config.ts`'s header comment). */
  async dataShareReadiness(id: string): Promise<DataShareReadiness> {
    const vendor = await this.vendors.findById(id);
    if (!vendor) throw new NotFoundException('Vendor not found');

    const activeDpa = await this.dpas.findActiveByVendorId(id);
    return computeDataShareReadiness(id, vendor.riskTier, activeDpa);
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Vendor audit (${input.action} ${input.entityId}) failed: ${(err as Error).message}`,
      );
    }
  }
}
