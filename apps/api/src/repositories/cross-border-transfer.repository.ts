import { Injectable } from '@nestjs/common';
import type { CrossBorderTransferRecord } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCrossBorderTransferInput {
  description: string;
  destinationCountry: string;
  legalBasis: string;
  legalBasisEvidenceRef: string | null;
  approvedByUserId: string;
}

export interface CrossBorderTransferScope {
  legalBasis?: string;
  destinationCountry?: string;
}

/** Cross-Border Transfer — owns `CrossBorderTransferRecord`. Append-only: no update/delete
 * method exists (see `cross-border-transfer.config.ts`'s header comment). */
@Injectable()
export class CrossBorderTransferRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    input: CreateCrossBorderTransferInput,
  ): Promise<CrossBorderTransferRecord> {
    return this.prisma.client.crossBorderTransferRecord.create({
      data: input,
    });
  }

  findById(id: string): Promise<CrossBorderTransferRecord | null> {
    return this.prisma.client.crossBorderTransferRecord.findUnique({
      where: { id },
    });
  }

  findMany(
    scope: CrossBorderTransferScope,
    take: number,
  ): Promise<CrossBorderTransferRecord[]> {
    return this.prisma.client.crossBorderTransferRecord.findMany({
      where: {
        ...(scope.legalBasis ? { legalBasis: scope.legalBasis } : {}),
        ...(scope.destinationCountry
          ? { destinationCountry: scope.destinationCountry }
          : {}),
      },
      orderBy: { transferredAt: 'desc' },
      take,
    });
  }
}
