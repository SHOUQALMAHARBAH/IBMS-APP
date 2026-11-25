// Part E — Claims Dashboard (backlog Process #64). dashboard.claims.view
// (already pre-seeded) gates this read.

import { apiGet } from '../auth/api-client';

export interface ClaimsAgeingBucketRow {
  count: number;
  valueJod: string;
}
export interface ClaimsAgeingBuckets {
  d0_30: ClaimsAgeingBucketRow;
  d31_60: ClaimsAgeingBucketRow;
  d61_90: ClaimsAgeingBucketRow;
  d90_plus: ClaimsAgeingBucketRow;
}

export interface LossRatioBreakdownRow {
  key: string;
  label: string;
  /** The same label in Arabic, or null — contents §أ row ١١. Populated for the insurer and
   *  line groupings only; `null` means render `label`, the English the record stored. */
  labelAr: string | null;
  periodClaims: string;
  periodPremium: string;
  ratio: string;
  ratioCapped: boolean;
  claimCount: number;
  policyCount: number;
}

export interface ClaimsDashboardSummary {
  generatedAt: string;
  asOf: string;
  openClaimsCount: number;
  closedClaimsCount: number;
  outstandingClaimsValueJod: string;
  ageing: ClaimsAgeingBuckets;
  lossRatioByClient: LossRatioBreakdownRow[];
  lossRatioByLine: LossRatioBreakdownRow[];
  lossRatioByInsurer: LossRatioBreakdownRow[];
}

export function getClaimsDashboard(
  opts: {
    branchId?: string;
    insuranceLine?: string;
    insurerId?: string;
    asOf?: string;
  } = {},
): Promise<ClaimsDashboardSummary> {
  const params = new URLSearchParams();
  if (opts.branchId) params.set('branchId', opts.branchId);
  if (opts.insuranceLine) params.set('insuranceLine', opts.insuranceLine);
  if (opts.insurerId) params.set('insurerId', opts.insurerId);
  if (opts.asOf) params.set('asOf', opts.asOf);
  const qs = params.toString();
  return apiGet(`/dashboards/claims${qs ? `?${qs}` : ''}`);
}
