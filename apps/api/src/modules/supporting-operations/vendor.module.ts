import { Module } from '@nestjs/common';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { VendorRepository } from '../../repositories/vendor.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 67 (backlog Part C #67, Domain H) — Procurement. The backlog's
 * own scope warning: no field-level detail or defined workflow exists in
 * either source document beyond "purchase requests and vendor selection
 * for non-insurance operational needs" — "the only task actually
 * executable from the source directly: use `Vendor` (with `vendorType=
 * other`) as the general vendor record for this purpose, without inventing
 * a purchase-request model that isn't in the text." See
 * `ibms-brain/meta/context/procurement.md`.
 *
 * `Vendor` pre-exists in the core schema (its own doc comment: "Merges
 * Process 71 (Vendor Management) and PDPL third-party governance") with
 * zero prior application code — this module is its first real consumer,
 * building only the foundational CRUD. #71 will layer risk tiering /
 * DPAs / the annual-review SLA on the SAME model + module later, not a
 * separate one.
 *
 *   - AuditModule -> AuditService (a CREATE/UPDATE row per write).
 *
 * No new permission, no migration — `vendor.manage` was already
 * pre-seeded ahead of time for #71's own future use.
 */
@Module({
  imports: [AuditModule],
  controllers: [VendorController],
  providers: [VendorService, VendorRepository],
})
export class VendorModule {}
