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
  /**
   * Present on EVERY row of all eight lists since migration `20261130100000_value_descriptions`, each
   * enforced by its own `*_description_required` CHECK. It used to be legal forms and business models
   * alone, on the reasoning that a city and a bank are satisfied by their Arabic name; the owner
   * reversed that on 2026-10-15 with a rule pointing the other way — where a value carries NO
   * consequence the description says so, because a person who believes his choice changes the system's
   * behaviour and later finds it does not stops trusting every list after it.
   *
   * Rendered by `SelectedValueDescription` under whichever select the value was chosen in. Nullable
   * here rather than `string` deliberately: the CHECK is the authority and this interface is
   * hand-copied over HTTP, so a type promising more than the wire carries would be a claim the
   * compiler cannot keep (§ the api-view drift class).
   */
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
  /** DECISION 88 — art. 10/a/2 and art. 10/a/3. OPTIONAL: absence does not block the save, it makes
   *  the derived registration pack incomplete. */
  premisesTenureFileName?: string;
  premisesTenureStorageRef?: string;
  associationMembershipFileName?: string;
  associationMembershipStorageRef?: string;
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
  /**
   * DECISION 88 — DERIVED, never stored, and it NAMES what is missing rather than counting it.
   *
   * `missing` lists the documents THIS SYSTEM does not hold. It is never a finding about the office:
   * an office licensed by the Central Bank has already submitted them to the regulator, so our not
   * holding a copy is a gap in our record.
   */
  registrationPack: {
    missing: ('premisesTenure' | 'associationMembership')[];
    complete: boolean;
  };
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

/**
 * MODULE 0-ب ITEM (e) — registering an INSURANCE COMPANY.
 *
 * ⚠️ HAND-COPIED OVER HTTP, like everything else in this file. When the api view shape changes, this
 * interface, the screen and every Playwright mock change in the SAME commit.
 */
export interface RegisterInsuranceCompanyInput {
  code: string;
  legalNameAr: string;
  legalName: string;
  shortName: string;
  legalFormId: string;
  nationalEstablishmentNo: string;
  commercialRegistrationNo: string;
  taxNumber: string;
  insurerLicenseNumber: string;
  licensingAuthorityId: string;
  businessModelId: string;
  licensedLineIds: string[];
  certificateFileName: string;
  certificateStorageRef: string;
  countryId: string;
  cityId: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  quotationEmail: string;
  claimsEmail: string;
  integrationMethod: 'API' | 'PORTAL' | 'EMAIL' | 'MANUAL';
  apiEndpoint?: string;
  bankId: string;
  iban: string;
  subdomain: string;
}

export interface RegisteredInsuranceCompany {
  id: string;
  code: string | null;
  legalName: string;
  legalNameAr: string;
  shortName: string | null;
  certificateDocumentId: string;
  licensedLineCount: number;
  /** DERIVED from the catalogue categories, never entered — decision 67. */
  licensedCategories: ('GENERAL' | 'LIFE')[];
}

export function registerInsuranceCompany(
  input: RegisterInsuranceCompanyInput,
): Promise<RegisteredInsuranceCompany> {
  return apiPost('/provider/insurance-companies', input);
}
