import { Injectable } from '@nestjs/common';
import type {
  DataClassification,
  DataSharingApproval,
  DataSharingChannel,
  Prisma,
} from '@ibms/db';
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
@Injectable()
export class DataSharingApprovalRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateDataSharingApprovalInput): Promise<DataSharingApproval> {
    return this.prisma.client.dataSharingApproval.create({ data: input });
  }

  findById(id: string): Promise<DataSharingApproval | null> {
    return this.prisma.client.dataSharingApproval.findUnique({
      where: { id },
    });
  }

  findMany(
    scope: DataSharingApprovalScope,
    take: number,
  ): Promise<DataSharingApproval[]> {
    return this.prisma.client.dataSharingApproval.findMany({
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
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.dataSharingApproval.updateMany({
      where: { id, decidedAt: null },
      data: { approvedByUserId, decidedAt },
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
