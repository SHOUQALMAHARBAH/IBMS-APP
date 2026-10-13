import { apiGet, apiPost } from '../auth/api-client';

/**
 * MODULE 0-ب ITEM (d) — the provider's registration client.
 *
 * ⚠️ THESE INTERFACES ARE HAND-COPIED OVER HTTP AND TYPESCRIPT CANNOT CHECK THEM. When the api view
 * shape changes, this file, the screen and every Playwright mock change in the SAME commit — the
 * customer-import panel shipped with two fields replaced by one, both read as `undefined`, and it
 * threw during render with nothing failing at compile time.
 */

/** One row of a provider-maintained vocabulary. */
export interface ReferenceRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  /** Present only where the VALUE CARRIES A RULE — legal forms and business models. Null on the six
   *  proper-noun lists, where the Arabic NAME is the whole answer. */
  descriptionAr: string | null;
}

export interface ReferenceData {
  countries: ReferenceRow[];
  cities: ReferenceRow[];
  banks: ReferenceRow[];
  currencies: ReferenceRow[];
  licensingAuthorities: ReferenceRow[];
  ratingAgencies: ReferenceRow[];
  legalForms: ReferenceRow[];
  businessModels: ReferenceRow[];
}

export function getReferenceData(): Promise<ReferenceData> {
  return apiGet('/reference-data');
}

export interface InsuranceLineOption {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  category: 'GENERAL' | 'LIFE';
}

/** The STANDARD catalogue only. A licence scope is chosen from the 32 standard lines; an office's
 *  own additional lines are recorded after it exists, so they cannot appear here. */
export function listStandardInsuranceLines(): Promise<InsuranceLineOption[]> {
  return apiGet('/insurance-lines');
}

export interface RegisterBrokerageOfficeInput {
  code: string;
  legalName: string;
  legalNameAr: string;
  tradeName?: string;
  legalFormId: string;
  nationalEstablishmentNo: string;
  commercialRegistrationNo: string;
  commercialRegistrationDate?: string;
  taxNumber: string;
  subdomain: string;
  brokerageKind: 'DIRECT' | 'REINSURANCE';
  brokerKind: 'NATURAL_PERSON' | 'CORPORATE';
  licenseNumber: string;
  licensingAuthorityId: string;
  licenseIssuedAt: string;
  licenseExpiresAt: string;
  certificateFileName: string;
  certificateStorageRef: string;
  renewalRequestedAt?: string;
  licensedLineIds: string[];
  countryId: string;
  cityId: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  generalManagerName: string;
  complianceOfficerName: string;
  complianceOfficerEmail: string;
  complianceOfficerPhone?: string;
  bankGuaranteeNo?: string;
  bankGuaranteeBankId?: string;
  bankGuaranteeAmount?: string;
  bankGuaranteeExpiry?: string;
  piPolicyNumber: string;
  piInsurerName: string;
  piCoverageLimit: string;
  piExpiresAt: string;
  paidUpCapital?: string;
  bankId: string;
  iban: string;
  currencyId: string;
}

export interface RegisteredOffice {
  id: string;
  code: string | null;
  legalName: string;
  legalNameAr: string;
  administratorRoleId: string;
  administratorGrantCount: number;
  /** DERIVED from the branch categories, never entered — decision 67. */
  licensedTypes: ('GENERAL' | 'LIFE')[];
  /**
   * Art. 4/a, as INFORMATION. `meetsRequirement: false` with `capitalIsUnrecorded: true` means
   * nobody typed a figure, which is a DIFFERENT FACT from a figure that is short — the screen must
   * render them differently or it tells an office it is undercapitalised when nobody entered a
   * number.
   */
  capital: {
    requiredCapital: string;
    paidUpCapital: string | null;
    shortfall: string | null;
    meetsRequirement: boolean;
    capitalIsUnrecorded: boolean;
  };
  /** Art. 10/b — false means the entered expiry is not a 31 December. A WARNING, never a block: the
   *  date is entered as printed on the certificate and the certificate is the authority. */
  expiryIsEndOfCalendarYear: boolean;
  /** Whether it matches the three-calendar-year term art. 10/b requires. NULL means no issue date
   *  on record, which is not the same as a mismatch. */
  expiryMatchesThreeYearTerm: boolean | null;
}

export function registerBrokerageOffice(
  input: RegisterBrokerageOfficeInput,
): Promise<RegisteredOffice> {
  return apiPost('/provider/brokerage-offices', input);
}
