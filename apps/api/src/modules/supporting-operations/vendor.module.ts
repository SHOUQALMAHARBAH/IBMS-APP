import { Module } from '@nestjs/common';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { DataProcessingAgreementController } from './data-processing-agreement.controller';
import { DataProcessingAgreementService } from './data-processing-agreement.service';
import { VendorRepository } from '../../repositories/vendor.repository';
import { DataProcessingAgreementRepository } from '../../repositories/data-processing-agreement.repository';
import { AuditModule } from '../audit/audit.module';
import { SlaModule } from '../sla/sla.module';

/**
 * Process 67 (Procurement) built the foundational `Vendor` CRUD in this
 * module. Process 71 (backlog Part C #71, Domain H — Vendor Management)
 * extends the SAME module — not a parallel one — with risk tiering, DPA
 * tracking, the annual-review SLA, and termination + access revocation.
 * See `vendor.config.ts` for the full design and
 * `ibms-brain/meta/context/vendor-management.md`.
 *
 *   - AuditModule -> AuditService (a CREATE/UPDATE row per write).
 *   - SlaModule   -> SlaTimerService (`vendor_annual_review`, already
 *     registered with zero prior caller; `vendor_termination_access_
 *     revocation`, a genuinely NEW registry entry this process added).
 *
 * No new permission, no migration — `vendor.manage` and `dpa.approve`
 * were both already pre-seeded.
 */
@Module({
  imports: [AuditModule, SlaModule],
  controllers: [VendorController, DataProcessingAgreementController],
  providers: [
    VendorService,
    VendorRepository,
    DataProcessingAgreementService,
    DataProcessingAgreementRepository,
  ],
})
export class VendorModule {}
