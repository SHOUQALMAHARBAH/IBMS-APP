// MODULE 0 ITEM (j) — the provider dashboard's client.
//
// ⚠️ HAND-COPIED OVER AN HTTP RESPONSE, AND TYPESCRIPT CANNOT CHECK IT. The same drift class that
// broke the customer-import result panel: when `ProviderOfficeStateView` changes in apps/api, this
// file changes in the SAME commit, and `provider-office-state.e2e-spec.ts` asserts these fields on
// the response body for exactly that reason.
//
// This is a CROSS-OFFICE read. Nothing here is customer, policy, premium or commission data, and
// nothing identifies a person — `lastActivityAt` is an office-level MAX. See the api service and
// migration 20261116100000 before adding a field.

import { apiGet } from '../auth/api-client';

export interface ProviderOfficeState {
  organizationId: string;
  legalName: string;
  legalNameAr: string | null;
  subdomain: string;
  organizationType: string;
  brokerKind: string | null;
  organizationStatus: string;
  onboardedAt: string;
  licenseNumber: string | null;
  licenseIssuedAt: string | null;
  licenseExpiresAt: string | null;
  renewalRequestedAt: string | null;
  /** DERIVED by the api from the regulatory rule, never by SQL. `null` = the office holds NO licence
   *  term, which is a THIRD state: it blocks new business (art. 21/a/9) and is not "lapsed". */
  isCurrentlyLapsed: boolean | null;
  renewalDueBy: string | null;
  renewalFiledOnTime: boolean | null;
  licensedBranches: number;
  dormantLicensedBranches: number;
  users: number;
  activeUsers: number;
  /** An OFFICE-level maximum. Never a person's sign-in. */
  lastActivityAt: string | null;
}

export function listProviderOffices(): Promise<ProviderOfficeState[]> {
  return apiGet<ProviderOfficeState[]>('/provider/offices');
}
