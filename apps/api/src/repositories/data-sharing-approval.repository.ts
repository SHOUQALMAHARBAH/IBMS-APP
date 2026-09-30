import { Injectable } from '@nestjs/common';
import type { DataClassification, DataSharingChannel, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateDataSharingApprovalInput {
  vendorId: string | null;
  description: string;
  classification: DataClassification;
  channel: DataSharingChannel;
  isRegulatoryChannel: boolean;
  requestedByUserId: string;
  slaDueAt: Date;
}

export interface DataSharingApprovalScope {
  vendorId?: string;
  classification?: string;
  pendingOnly?: boolean;
}

/** M08 — owns `DataSharingApproval`. `approve`/`decline` are both
 * status-conditional `updateMany` calls re-asserting `decidedAt: null` in
 * the `where` — a decision is made exactly once (race-safe-invariants.md). */
/**
 * The combined-duty act, on every read and write that returns a row.
 *
 * `DataSharingApproval_maker_checker_distinct` requires that whoever requests a data-sharing approval
 * is not whoever decides it — and this pair guards **personal data leaving the office to a third
 * party**, which is why its own constraint guards only the checker side for NULL.
 *
 * Part 4 step 5: on the record, not only in the report at `/internal-controls`.
 */
const SHARING_INCLUDE = { combinedDutyAct: true } as const;

export type DataSharingApprovalWithAct = Prisma.DataSharingApprovalGetPayload<{
  include: typeof SHARING_INCLUDE;
}>;

@Injectable()
export class DataSharingApprovalRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    input: CreateDataSharingApprovalInput,
  ): Promise<DataSharingApprovalWithAct> {
    // The include on the write too, so one shape serves every path out of this repository — a caller
    // cannot receive a row whose act state is unknowable. A newly requested approval has no act.
    return this.prisma.client.dataSharingApproval.create({
      data: input,
      include: SHARING_INCLUDE,
    });
  }

  findById(id: string): Promise<DataSharingApprovalWithAct | null> {
    return this.prisma.client.dataSharingApproval.findUnique({
      where: { id },
      include: SHARING_INCLUDE,
    });
  }

  findMany(
    scope: DataSharingApprovalScope,
    take: number,
  ): Promise<DataSharingApprovalWithAct[]> {
    return this.prisma.client.dataSharingApproval.findMany({
      include: SHARING_INCLUDE,
      where: {
        ...(scope.vendorId ? { vendorId: scope.vendorId } : {}),
        ...(scope.classification
          ? { classification: scope.classification as never }
          : {}),
        ...(scope.pendingOnly ? { decidedAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** 0 rows if already decided. */
  approve(
    id: string,
    approvedByUserId: string,
    decidedAt: Date,
    /**
     * Part 4 — the declared combined-duty act, when the checker IS the maker in an office that has declared
     * COMBINED mode. Null on every ordinary two-person act. The column is what this pair's CHECK constraint
     * reads: with it null, a self-approval is refused by the database whatever the application decided.
     */
    combinedDutyActId: string | null = null,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.dataSharingApproval.updateMany({
      where: { id, decidedAt: null },
      data: {
        approvedByUserId,
        decidedAt,
        ...(combinedDutyActId === null ? {} : { combinedDutyActId }),
      },
    });
  }

  /** Leaves approvedByUserId null — "reviewed and declined." 0 rows if
   * already decided. */
  decline(id: string, decidedAt: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.client.dataSharingApproval.updateMany({
      where: { id, decidedAt: null },
      data: { decidedAt },
    });
  }
}
