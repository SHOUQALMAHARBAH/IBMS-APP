// Process 5/6 — Risk Profile + the Process 6 asset survey. Talks to apps/api's
// risk-profile module (risk-profile.controller.ts). Mirrors lib/prospect/
// prospect-api.ts's conventions. Money values are fils-precision decimal
// strings, never JS numbers (ibms-brain/meta/lex/money-decimal-jod.md).

import { apiDelete, apiGet, apiPatch, apiPost } from '../auth/api-client';

export const ASSET_TYPES = [
  'building',
  'equipment',
  'stock',
  'vehicle',
  'other',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export interface RiskProfile {
  id: string;
  customerId: string;
  siteLabel: string | null;
  priorClaimsHistorySummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  riskProfileId: string;
  assetType: AssetType;
  description: string | null;
  declaredValue: string | null;
  annualGrossProfit: string | null;
  indemnityPeriodMonths: number | null;
  fleetVehicleCount: number | null;
  createdAt: string;
}

export interface SumInsuredSummary {
  propertySumInsured: string;
  businessInterruptionSumInsured: string;
  totalSumInsured: string;
  indemnityPeriodMonths: number | null;
  fleetVehicleCount: number;
  assetCount: number;
}

export interface RiskProfileWithSurvey extends RiskProfile {
  assets: Asset[];
  sumInsured: SumInsuredSummary;
}

export interface AssetInput {
  assetType: AssetType;
  description?: string;
  declaredValue?: string;
  annualGrossProfit?: string;
  indemnityPeriodMonths?: number;
  fleetVehicleCount?: number;
}

export interface ConsolidatedSurvey {
  customerId: string;
  sites: {
    riskProfileId: string;
    siteLabel: string | null;
    summary: SumInsuredSummary;
  }[];
  consolidated: {
    propertySumInsured: string;
    businessInterruptionSumInsured: string;
    totalSumInsured: string;
    indemnityPeriodMonths: number | null;
    fleetVehicleCount: number;
    siteCount: number;
  };
}

export interface CreateRiskProfileInput {
  customerId: string;
  siteLabel?: string;
  priorClaimsHistorySummary?: string;
}

export function createRiskProfile(
  input: CreateRiskProfileInput,
): Promise<RiskProfile> {
  return apiPost('/risk-profiles', input);
}

export function listRiskProfiles(customerId: string): Promise<RiskProfile[]> {
  return apiGet(`/risk-profiles?customerId=${encodeURIComponent(customerId)}`);
}

export function getRiskProfile(id: string): Promise<RiskProfileWithSurvey> {
  return apiGet(`/risk-profiles/${id}`);
}

export function getConsolidatedRiskProfiles(
  customerId: string,
): Promise<ConsolidatedSurvey> {
  return apiGet(
    `/risk-profiles/consolidated?customerId=${encodeURIComponent(customerId)}`,
  );
}

export function addAsset(
  riskProfileId: string,
  input: AssetInput,
): Promise<Asset> {
  return apiPost(`/risk-profiles/${riskProfileId}/assets`, input);
}

export function updateAsset(
  riskProfileId: string,
  assetId: string,
  input: AssetInput,
): Promise<Asset> {
  return apiPatch(`/risk-profiles/${riskProfileId}/assets/${assetId}`, input);
}

export function deleteAsset(
  riskProfileId: string,
  assetId: string,
): Promise<void> {
  return apiDelete(`/risk-profiles/${riskProfileId}/assets/${assetId}`);
}
