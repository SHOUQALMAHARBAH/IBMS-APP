import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Vendor } from '@ibms/db';
import { VendorRepository } from '../../repositories/vendor.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import type { CreateVendorDto } from './dto/create-vendor.dto';
import type { UpdateVendorDto } from './dto/update-vendor.dto';
import type { ListVendorsQueryDto } from './dto/list-vendors-query.dto';

/** Process 67 — the foundational `Vendor` CRUD. See `vendor.config.ts` for
 * why this stays deliberately minimal (no purchase-request model, no risk
 * tiering — #71's job) and `ibms-brain/meta/context/procurement.md`. */
@Injectable()
export class VendorService {
  private readonly logger = new Logger(VendorService.name);

  constructor(
    private readonly vendors: VendorRepository,
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

  list(query: ListVendorsQueryDto): Promise<Vendor[]> {
    return this.vendors.findMany({ vendorType: query.vendorType });
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
