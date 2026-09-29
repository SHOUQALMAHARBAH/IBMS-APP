import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
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
/**
 * The combined-duty act, on every read and write that returns an agreement.
 *
 * `DataProcessingAgreement_maker_checker_distinct` requires that whoever ASSESSES a processor's data
 * protection is not whoever approves the agreement (`assessedByUserId` / `dpoApprovedByUserId`). A DPA is
 * what makes a third party lawful to send personal data to at all, so whether two people agreed is what
 * the record is for.
 *
 * Part 4 step 5: on the record, not only in the report at `/internal-controls`.
 */
const DPA_INCLUDE = { combinedDutyAct: true } as const;

export type DataProcessingAgreementWithAct =
  Prisma.DataProcessingAgreementGetPayload<{ include: typeof DPA_INCLUDE }>;

@Injectable()
export class DataProcessingAgreementRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateDpaInput): Promise<DataProcessingAgreementWithAct> {
    return this.prisma.client.dataProcessingAgreement.create({
      include: DPA_INCLUDE,
      data: input,
    });
  }

  findById(id: string): Promise<DataProcessingAgreementWithAct | null> {
    return this.prisma.client.dataProcessingAgreement.findUnique({
      include: DPA_INCLUDE,
      where: { id },
    });
  }

  findByVendorId(vendorId: string): Promise<DataProcessingAgreementWithAct[]> {
    return this.prisma.client.dataProcessingAgreement.findMany({
      include: DPA_INCLUDE,
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
  ): Promise<DataProcessingAgreementWithAct | null> {
    return this.prisma.client.dataProcessingAgreement.findFirst({
      include: DPA_INCLUDE,
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
  ): Promise<DataProcessingAgreementWithAct | null> {
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
    /**
     * Part 4 — the declared combined-duty act, when the checker IS the maker in an office that has declared
     * COMBINED mode. Null on every ordinary two-person act, which is every one until an office declares it.
     * The column is what this pair's CHECK constraint reads: with it null, a self-approval is refused by the
     * database whatever the application decided.
     */
    combinedDutyActId: string | null = null,
  ): Promise<DataProcessingAgreementWithAct | null> {
    const result = await this.prisma.client.dataProcessingAgreement.updateMany({
      where: { id, dpoApprovedByUserId: null },
      data: {
        dpoApprovedByUserId,
        ...(combinedDutyActId === null ? {} : { combinedDutyActId }),
      },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }
}
