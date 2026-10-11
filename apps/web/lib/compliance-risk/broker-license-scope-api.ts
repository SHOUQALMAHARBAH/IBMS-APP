// Module 0 item (e) — WHAT the office is licensed for: insurance types (life / general) and the
// branches within each, plus the art. 4/a capital assessment.
//
// ⚠️ HAND-COPIED OVER AN HTTP RESPONSE, AND TYPESCRIPT CANNOT CHECK IT. The same drift class that
// broke the customer-import result panel. When `LicenseScopeView` changes in apps/api, this file
// changes in the same commit — and the api e2e asserts these fields on the response body for
// exactly that reason.

import { apiDelete, apiGet, apiPost } from '../auth/api-client';

export type InsuranceLineCategory = 'GENERAL' | 'LIFE';

/** One licensed branch. `code` is null for an office's own line — an addition has no catalogue code. */
export interface LicenseScopeBranch {
  id: string;
  brokerLicenseId: string;
  insuranceLineId: string | null;
  officeInsuranceLineId: string | null;
  /** DERIVED from the catalogue, never stored on the scope row. */
  category: InsuranceLineCategory;
  nameEn: string;
  nameAr: string;
  code: string | null;
}

export interface LicenseScope {
  brokerLicenseId: string;
  /** The distinct categories of the branches, in catalogue order. */
  types: InsuranceLineCategory[];
  branches: LicenseScopeBranch[];
  branchCountByType: Partial<Record<InsuranceLineCategory, number>>;
  /**
   * Module 0 item (f). On the view so the screen can state the requirement while the form is still
   * empty — a rule that only speaks when it refuses teaches by failure.
   */
  staffing: {
    requiredApprovedStaff: number;
    currentApprovedStaff: number;
    meetsRequirement: boolean;
  };
  brokerKind: 'NATURAL_PERSON' | 'CORPORATE' | null;
  /**
   * Art. 4/a. Money arrives as fixed 3dp STRINGS — a JOD figure never crosses the wire as a
   * number, so it cannot pick up a float rounding error on the way to a screen.
   */
  capital: {
    requiredCapital: string;
    paidUpCapital: string | null;
    shortfall: string | null;
    meetsRequirement: boolean;
    /** No figure recorded at all — deliberately NOT the same as "recorded and too low". */
    capitalIsUnrecorded: boolean;
  };
}

export function getLicenseScope(): Promise<LicenseScope> {
  return apiGet('/broker-license/scope');
}

/**
 * Adds one branch. Name exactly one id — the standard catalogue or this office's own.
 *
 * 422 when it would give a sole establishment a second insurance type (art. 3/a); 409 when the
 * branch is already on the term.
 */
export function addLicenseScopeBranch(input: {
  insuranceLineId?: string;
  officeInsuranceLineId?: string;
}): Promise<LicenseScope> {
  return apiPost('/broker-license/scope', input);
}

export function removeLicenseScopeBranch(id: string): Promise<LicenseScope> {
  return apiDelete(`/broker-license/scope/${id}`);
}
