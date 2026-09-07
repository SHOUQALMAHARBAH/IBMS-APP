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
  /** Part F item #6 — pre-resolved ids from a full-text search
   * (searchIds()); undefined means no search filter is active. */
  id?: string[];
}

/**
 * Process 67 (backlog Part C #67, Domain H) built the foundational `Vendor`
 * CRUD; Process 71 (backlog Part C #71) extends the SAME repository with
 * risk tiering, the annual-review reschedule, and the two termination
 * fields — see `vendor.config.ts` for the full design.
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
      where: {
        vendorType: filter.vendorType,
        id: filter.id ? { in: filter.id } : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Part F item #6 — bilingual full-text search over name. See
   * CustomerRepository.searchIds()'s own comment for the full
   * mechanism/safety rationale (identical here). */
  async searchIds(term: string): Promise<string[]> {
    const rows = await this.prisma.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Vendor"
      WHERE "searchVector" @@ (
        websearch_to_tsquery('arabic', ${term}) ||
        websearch_to_tsquery('english', ${term})
      )
    `;
    return rows.map((r) => r.id);
  }

  update(id: string, input: UpdateVendorInput): Promise<Vendor> {
    return this.prisma.client.vendor.update({ where: { id }, data: input });
  }

  setRiskTier(id: string, riskTier: string): Promise<Vendor> {
    return this.prisma.client.vendor.update({
      where: { id },
      data: { riskTier },
    });
  }

  scheduleAnnualReview(id: string, dueAt: Date): Promise<Vendor> {
    return this.prisma.client.vendor.update({
      where: { id },
      data: { annualReviewDueAt: dueAt },
    });
  }

  /** Status-conditional: only stamps a vendor that has not already been
   * terminated (race-safe-invariants.md) — returns `null` if 0 rows
   * matched (already terminated). */
  async terminate(id: string, confirmedAt: Date): Promise<Vendor | null> {
    const result = await this.prisma.client.vendor.updateMany({
      where: { id, terminationDataReturnConfirmedAt: null },
      data: { terminationDataReturnConfirmedAt: confirmedAt },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }

  /** Status-conditional: only stamps a vendor whose access has not already
   * been revoked. Returns `null` if 0 rows matched. */
  async revokeAccess(id: string, revokedAt: Date): Promise<Vendor | null> {
    const result = await this.prisma.client.vendor.updateMany({
      where: { id, accessRevokedAt: null },
      data: { accessRevokedAt: revokedAt },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }
}
