import { apiGet } from '../auth/api-client';

/**
 * MODULE 0-ب ITEM (f), COMPANY HALF — the company's own registry record.
 *
 * ⚠️ THESE INTERFACES ARE HAND-COPIED OVER HTTP AND TYPESCRIPT CANNOT CHECK THEM. When the api view
 * shape changes, this file, the screen and every Playwright mock change in the SAME commit — the
 * customer-import panel shipped with two fields replaced by one, both read as `undefined`, and it
 * threw during render with nothing failing at compile time.
 *
 * READ-ONLY BY DESIGN. There is no PATCH, no POST and no client function for one: a company's
 * registry record is what the PROVIDER filed, and a company editing it from here would make two
 * sources of truth for a regulator-facing fact. Correcting it is the provider's act.
 */

/** A provider-maintained vocabulary row, as the record renders it. Both names, because the caller is
 *  the one that knows which language it is showing. */
export interface NamedRow {
  code: string;
  nameEn: string;
  nameAr: string | null;
}

export interface CompanyIdentity {
  id: string;
  legalName: string;
  legalNameAr: string | null;
  shortName: string | null;
  code: string | null;
  nationalEstablishmentNo: string | null;
  commercialRegistrationNo: string | null;
  taxNumber: string | null;
  insurerLicenseNumber: string | null;
  /**
   * BATCH 5 GROUP 7d — the DERIVED licence standing. Hand-copied over HTTP like everything else in
   * this file, so when the api view changes this type, the screen and every Playwright mock move in
   * the SAME commit — the customer-import panel is why that rule exists.
   */
  licenseStanding: {
    standing: 'NO_TERM_ON_RECORD' | 'CURRENT' | 'EXPIRED';
    currentTerm: {
      licenseNumber: string;
      issuedAt: string | null;
      expiresAt: string;
    } | null;
    termCount: number;
  };
  legalForm: NamedRow | null;
  licensingAuthority: NamedRow | null;
  businessModel: NamedRow | null;
  country: NamedRow | null;
  city: NamedRow | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  quotationEmail: string | null;
  claimsEmail: string | null;
  integrationMethod: string | null;
  registeredAt: string;
}

export interface LicensedLine {
  code: string;
  nameEn: string;
  nameAr: string | null;
  category: 'GENERAL' | 'LIFE';
}

export interface CompanyRecord {
  identity: CompanyIdentity;
  licensedLines: LicensedLine[];
  /** DERIVED from the lines' categories, never stored — decision 67. */
  licensedCategories: ('GENERAL' | 'LIFE')[];
  certificate: { id: string; fileName: string; recordedAt: string } | null;
  /**
   * WHAT WE HOLD, never a finding about the company — decision 88's rule four, written for the
   * office registration pack and applying here unchanged. A company licensed by the Central Bank
   * already filed these with the regulator; our not holding a copy is OUR gap.
   */
  recordState: {
    certificateOnRecord: boolean;
    licensedLineCount: number;
  };
}

export function fetchOwnRecord(): Promise<CompanyRecord> {
  return apiGet<CompanyRecord>('/company/registry-record');
}
