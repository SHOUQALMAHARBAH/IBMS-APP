import { Injectable } from '@nestjs/common';
import type { Vendor } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateVendorInput {
  name: string;
  vendorType: string;
}

export interface UpdateVendorInput {
  name?: string;
  vendorType?: string;
}

export interface VendorFilter {
  vendorType?: string;
}

/**
 * Process 67 (backlog Part C #67, Domain H) — the foundational `Vendor`
 * CRUD both #67 (Procurement, `vendorType='other'`) and #71 (Vendor
 * Management, the other six types) share. `riskTier` and the DPA/
 * annual-review fields are #71's own concern — no method here reads or
 * writes them.
 */
@Injectable()
export class VendorRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateVendorInput): Promise<Vendor> {
    return this.prisma.client.vendor.create({ data: input });
  }

  findById(id: string): Promise<Vendor | null> {
    return this.prisma.client.vendor.findUnique({ where: { id } });
  }

  findMany(filter: VendorFilter): Promise<Vendor[]> {
    return this.prisma.client.vendor.findMany({
      where: { vendorType: filter.vendorType },
      orderBy: { createdAt: 'desc' },
    });
  }

  update(id: string, input: UpdateVendorInput): Promise<Vendor> {
    return this.prisma.client.vendor.update({ where: { id }, data: input });
  }
}
