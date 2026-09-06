import { Injectable } from '@nestjs/common';
import type { DataClassification, InformationAsset } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateInformationAssetInput {
  name: string;
  assetType: string;
  ownerUserId: string;
  classification: DataClassification;
}

export interface UpdateInformationAssetInput {
  name?: string;
  assetType?: string;
  ownerUserId?: string;
  classification?: DataClassification;
}

export interface InformationAssetFilter {
  assetType?: string;
  classification?: DataClassification;
}

/**
 * Process 69 (backlog Part C #69, Domain H) — the ISO 27001 Clause 8.1
 * asset inventory. `InformationAsset` pre-exists in the core schema with
 * zero prior application code — this is its first real consumer.
 */
@Injectable()
export class InformationAssetRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateInformationAssetInput): Promise<InformationAsset> {
    return this.prisma.client.informationAsset.create({ data: input });
  }

  findById(id: string): Promise<InformationAsset | null> {
    return this.prisma.client.informationAsset.findUnique({ where: { id } });
  }

  findMany(filter: InformationAssetFilter): Promise<InformationAsset[]> {
    return this.prisma.client.informationAsset.findMany({
      where: {
        assetType: filter.assetType,
        classification: filter.classification,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  update(
    id: string,
    input: UpdateInformationAssetInput,
  ): Promise<InformationAsset> {
    return this.prisma.client.informationAsset.update({
      where: { id },
      data: input,
    });
  }
}
