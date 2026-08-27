import { Injectable } from '@nestjs/common';
import type { Asset, Prisma, RiskProfile } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateRiskProfileInput {
  customerId: string;
  siteLabel?: string;
  priorClaimsHistorySummary?: string;
}

export interface CreateAssetInput {
  riskProfileId: string;
  assetType: string;
  description?: string;
  declaredValue?: Prisma.Decimal;
  annualGrossProfit?: Prisma.Decimal;
  indemnityPeriodMonths?: number;
  fleetVehicleCount?: number;
}

/** A PATCH on an asset replaces its survey fields wholesale (see
 * CreateAssetDto) — `updateAsset` nulls out anything the new body omits. */
export type UpdateAssetInput = Omit<CreateAssetInput, 'riskProfileId'>;

/** Process 5/6 — the parent Risk Profile record plus its `Asset` survey
 * lines (Process 6, backlog Part C #6). Same "one repository per aggregate
 * root" shape as lead/prospect/customer — an Asset only ever exists inside
 * one Risk Profile's survey and is only read/written through here. */
@Injectable()
export class RiskProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateRiskProfileInput): Promise<RiskProfile> {
    return this.prisma.client.riskProfile.create({ data: input });
  }

  findById(id: string): Promise<RiskProfile | null> {
    return this.prisma.client.riskProfile.findUnique({ where: { id } });
  }

  findManyByCustomerId(customerId: string): Promise<RiskProfile[]> {
    return this.prisma.client.riskProfile.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- Asset survey (Process 6) -------------------------------------------

  createAsset(input: CreateAssetInput): Promise<Asset> {
    return this.prisma.client.asset.create({ data: input });
  }

  findAssetById(id: string): Promise<Asset | null> {
    return this.prisma.client.asset.findUnique({ where: { id } });
  }

  findAssetsByRiskProfileId(riskProfileId: string): Promise<Asset[]> {
    return this.prisma.client.asset.findMany({
      where: { riskProfileId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Every asset behind a customer's whole book of Risk Profiles — one query
   * feeding the multi-site consolidation (RiskProfileService.getConsolidated). */
  findAssetsByCustomerId(customerId: string): Promise<Asset[]> {
    return this.prisma.client.asset.findMany({
      where: { riskProfile: { customerId } },
      orderBy: { createdAt: 'asc' },
    });
  }

  updateAsset(id: string, data: UpdateAssetInput): Promise<Asset> {
    return this.prisma.client.asset.update({
      where: { id },
      data: {
        assetType: data.assetType,
        description: data.description ?? null,
        declaredValue: data.declaredValue ?? null,
        annualGrossProfit: data.annualGrossProfit ?? null,
        indemnityPeriodMonths: data.indemnityPeriodMonths ?? null,
        fleetVehicleCount: data.fleetVehicleCount ?? null,
      },
    });
  }

  deleteAsset(id: string): Promise<Asset> {
    return this.prisma.client.asset.delete({ where: { id } });
  }
}
