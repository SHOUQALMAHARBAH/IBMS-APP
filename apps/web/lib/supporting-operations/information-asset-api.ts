// Process 69 — Cybersecurity (backlog Part C #69, Domain H). Calls apps/api's
// /information-assets routes — the ISO 27001 Clause 8.1 asset inventory.
// information-asset.manage (a NEW permission this process needed — unlike
// #66/#67, no pre-seeded grant existed).

import { apiGet, apiPatch, apiPost } from '../auth/api-client';

export const ASSET_TYPES = [
  'customer_data',
  'policy_data',
  'document_store',
  'backup',
  'integration',
  'other',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const DATA_CLASSIFICATIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'HIGHLY_CONFIDENTIAL',
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export interface InformationAsset {
  id: string;
  name: string;
  assetType: string;
  ownerUserId: string;
  classification: DataClassification;
  createdAt: string;
}

export function listInformationAssets(filter?: {
  assetType?: string;
  classification?: string;
}): Promise<InformationAsset[]> {
  const params = new URLSearchParams();
  if (filter?.assetType) params.set('assetType', filter.assetType);
  if (filter?.classification) params.set('classification', filter.classification);
  const query = params.toString();
  return apiGet(`/information-assets${query ? `?${query}` : ''}`);
}

export function createInformationAsset(input: {
  name: string;
  assetType: AssetType;
  ownerUserId: string;
  classification: DataClassification;
}): Promise<InformationAsset> {
  return apiPost('/information-assets', input);
}

export function updateInformationAsset(
  id: string,
  input: { name?: string; assetType?: AssetType; classification?: DataClassification },
): Promise<InformationAsset> {
  return apiPatch(`/information-assets/${id}`, input);
}
