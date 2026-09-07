import { Injectable } from '@nestjs/common';
import type { DataProcessingAgreement } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateDpaInput {
  vendorId: string;
  assessedByUserId: string;
}

/**
 * Process 71 (backlog Part C #71, Domain H) — `DataProcessingAgreement`
 * (Part 7.5) pre-exists with a DB `CHECK` constraint on its maker/checker
 * pair (`assessedByUserId`/`dpoApprovedByUserId`) already in place since
 * the A.5 foundational work, but zero prior application writer — this
 * repository is that first real consumer.
 */
@Injectable()
export class DataProcessingAgreementRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateDpaInput): Promise<DataProcessingAgreement> {
    return this.prisma.client.dataProcessingAgreement.create({
      data: input,
    });
  }

  findById(id: string): Promise<DataProcessingAgreement | null> {
    return this.prisma.client.dataProcessingAgreement.findUnique({
      where: { id },
    });
  }

  findByVendorId(vendorId: string): Promise<DataProcessingAgreement[]> {
    return this.prisma.client.dataProcessingAgreement.findMany({
      where: { vendorId },
      orderBy: [{ signedAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** The vendor's currently-effective DPA for readiness purposes: signed,
   * and either open-ended or not yet expired. Ties broken by `signedAt`
   * descending then `id` descending — the #53-54 deterministic-tiebreak
   * precedent (`PiPolicyRepository.findCurrent()`). */
  findActiveByVendorId(
    vendorId: string,
  ): Promise<DataProcessingAgreement | null> {
    return this.prisma.client.dataProcessingAgreement.findFirst({
      where: {
        vendorId,
        signedAt: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ signedAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** Status-conditional: only signs an unsigned DPA. `null` if 0 rows
   * matched (already signed). */
  async sign(
    id: string,
    signedAt: Date,
  ): Promise<DataProcessingAgreement | null> {
    const result = await this.prisma.client.dataProcessingAgreement.updateMany({
      where: { id, signedAt: null },
      data: { signedAt },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }

  /** Status-conditional: only approves a DPA with no existing DPO
   * approval. `null` if 0 rows matched (already approved). */
  async dpoApprove(
    id: string,
    dpoApprovedByUserId: string,
  ): Promise<DataProcessingAgreement | null> {
    const result = await this.prisma.client.dataProcessingAgreement.updateMany({
      where: { id, dpoApprovedByUserId: null },
      data: { dpoApprovedByUserId },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }
}
