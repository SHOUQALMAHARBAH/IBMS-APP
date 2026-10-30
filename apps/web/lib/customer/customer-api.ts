// Process 3-4 — Customer Acquisition/Onboarding. Talks to apps/api's
// customer module (customer.controller.ts). Mirrors lib/prospect/
// prospect-api.ts's conventions (thin typed wrappers over apiGet/apiPost).

import type { Paginated } from '../api/paginated';
import { apiGet, apiPatch, apiPost } from '../auth/api-client';

export type CustomerType = 'INDIVIDUAL' | 'CORPORATE';
export type CustomerStatus = 'PENDING_KYC' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type LanguagePreference = 'AR' | 'EN';

// Mirrors apps/api's MaskedCustomer (customer.service.ts) — the API never
// returns the raw nationalIdEnc/contactPhoneEnc/contactEmailEnc columns,
// only a masked display value (Part 10.6).
export interface Customer {
  id: string;
  prospectId: string | null;
  customerType: CustomerType;
  legalName: string;
  // Individual only — Jordanian national-ID-convention name parts (Part F
  // item #4). Null for a CORPORATE customer, and for a historical
  // individual record created before this item shipped.
  givenName: string | null;
  fatherName: string | null;
  grandfatherName: string | null;
  familyName: string | null;
  // Part B §11 screening discriminators. The api has always returned these in
  // the clear - deliberately, so a reviewer can tell two people of the same
  // name apart - but the web type never declared them. The customer source of
  // EntitySearch is what needs exactly that, for its disambiguation line.
  dateOfBirth: string | null;
  nationality: string | null;
  registrationNumber: string | null;
  taxRegistrationNumber: string | null;
  registeredAddress: string | null;
  natureOfBusiness: string | null;
  languagePreference: LanguagePreference;
  status: CustomerStatus;
  classification: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  nationalId: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface CreateCustomerInput {
  customerType: CustomerType;
  /** Corporate only — an individual's legalName is computed server-side
   * from givenName/fatherName/grandfatherName/familyName. */
  legalName?: string;
  /** Individual only — Jordanian national-ID-convention name parts (Part F
   * item #4). givenName/familyName are required whenever customerType is
   * INDIVIDUAL; fatherName/grandfatherName are optional. */
  givenName?: string;
  fatherName?: string;
  grandfatherName?: string;
  familyName?: string;
  nationalId?: string;
  /**
   * THE TWO SCREENING DISCRIMINATORS — `YYYY-MM-DD` and ISO 3166-1 alpha-2,
   * upper case (the column's CHECK is `^[A-Z]{2}$`).
   *
   * The api's DTO has accepted both since the columns shipped and this
   * hand-copied interface never declared them, so no screen could send one
   * even by mistake. That is the same drift class `legacy-import-shape-parity`
   * exists for, in the other direction: a field the SERVER accepts and the
   * client cannot express is a capability nothing can reach, and no type sees
   * it because there is nothing to disagree with.
   *
   * Individual only. A company has no date of birth or nationality of its own;
   * those belong to its UBOs, which is what `CreateUboInput` carries them for.
   */
  dateOfBirth?: string;
  nationality?: string;
  registrationNumber?: string;
  taxRegistrationNumber?: string;
  registeredAddress?: string;
  natureOfBusiness?: string;
  contactPhone: string;
  contactEmail: string;
  languagePreference: LanguagePreference;
  prospectId?: string;
  /** LAYER 1 — the officer's answer to "a customer with this name already exists". Sent only when the
   * warning actually fired; a create with no warning behind it carries neither field. */
  duplicateNameSamePerson?: boolean;
  duplicateNameMatchCount?: number;
}

export interface ListCustomersFilter {
  /** 0-based. Out-of-range values are clamped server-side. */
  page?: number;

  ownerUserId?: string;
  status?: CustomerStatus;
  /** Part F item #6 — bilingual full-text search over legalName. */
  search?: string;
}

export interface Ubo {
  id: string;
  customerId: string;
  fullName: string;
  givenName: string | null;
  fatherName: string | null;
  grandfatherName: string | null;
  familyName: string | null;
  ownershipPercent: string | null;
  isAuthorizedSignatory: boolean;
  isPep: boolean;
  createdAt: string;
  nationalId: string | null;
}

export interface CreateUboInput {
  /** Jordanian national-ID-convention name parts (Part F item #4) — a UBO
   * is always a real individual. `fullName` is computed server-side from
   * these, not accepted directly. */
  givenName: string;
  fatherName?: string;
  grandfatherName?: string;
  familyName: string;
  nationalId: string;
  /** As on `CreateCustomerInput`. A UBO is always a natural person, so these
   *  are the discriminators a CORPORATE customer's screening has to rely on —
   *  and measured, 2 of 2 UBOs carried neither. */
  dateOfBirth?: string;
  nationality?: string;
  ownershipPercent?: number;
  isAuthorizedSignatory?: boolean;
  isPep: boolean;
}

export type DocumentClassification = 'CONFIDENTIAL' | 'HIGHLY_CONFIDENTIAL';

export interface CustomerDocument {
  id: string;
  category: string;
  classification: DocumentClassification;
  fileName: string;
  storageRef: string;
  createdAt: string;
}

export interface CreateCustomerDocumentInput {
  classification: DocumentClassification;
  fileName: string;
  storageRef: string;
}

export type RevealableField = 'nationalId' | 'contactPhone' | 'contactEmail';

export function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  return apiPost('/customers', input);
}

/** One same-name customer the officer is shown, so they can recognise the person rather than a count. */
export interface DuplicateNameMatch {
  id: string;
  legalName: string;
  /* `CustomerStatus`, not `string` — this is a CUSTOMER's status, and `Customer.status`
   * in this same file already declares the union. Two declarations of one field, one of
   * them loose, is how a label map ends up indexed with a type it cannot take.
   *
   * AND IT IS NOT A SCREENING-MATCH STATUS, which decision 59 is about: I read this site
   * as one and the compiler refused it. `raw-stored-values.py` calls `status` AMBIGUOUS
   * BY TYPE for exactly this reason. */
  status: CustomerStatus;
}

export interface DuplicateNameCheck {
  canonicalKey: string;
  matches: DuplicateNameMatch[];
}

/**
 * LAYER 1 of duplicate prevention: does a customer with this person's name already exist?
 *
 * Keyed on the ORDERED canonical person key, which is a different key from the one behind the insurer
 * directory: that one SORTS its tokens so two spellings of one company merge, and sorting merges two
 * cousins who share three of four name parts. Measured on dev before the keys were built — the sorted
 * key folded 15 individuals into collisions including 8 genuine cousin pairs, the ordered key folded 7
 * and no cousins.
 *
 * INDIVIDUAL only. A company is keyed on its public registration number by a hard unique index, so
 * there is nothing to ask about — the write is simply refused.
 */
export function checkDuplicateCustomerName(
  legalName: string,
): Promise<DuplicateNameCheck> {
  return apiGet(
    `/customers/duplicate-name-check?legalName=${encodeURIComponent(legalName)}`,
  );
}

/**
 * Records that the warning WORKED — the officer recognised the person and did not create a second row.
 *
 * Called instead of `createCustomer`, never beside it. This is the outcome a flag on the customer could
 * not record, because there is no customer; without it the measurement behind the deferred layer-2
 * decision would count only the times the warning was ignored.
 */
export function recordAbandonedDuplicate(input: {
  legalName: string;
  matchCount: number;
}): Promise<{ recorded: true }> {
  return apiPost('/customers/duplicate-name-abandoned', input);
}

/**
 * What `GET /customers/search` returns — narrower than a list row, on purpose.
 *
 * No contact fields and no screening discriminators: a picker needs enough to tell two entries apart
 * and nothing more, and this endpoint is reachable by every holder of `customer.read`.
 */
export interface CustomerSearchResult {
  id: string;
  legalName: string;
  customerType: 'INDIVIDUAL' | 'CORPORATE';
  status: Customer['status'];
  registrationNumber: string | null;
  taxRegistrationNumber: string | null;
}

/**
 * The one field that finds a named customer — NOT the list route with a filter.
 *
 * `q` is mandatory with a three-character floor server-side, the result is bounded at ten, and every
 * call writes an audit row. Those are the owner's four anti-browsing conditions and they are enforced by
 * the SERVER: this function exists so a screen cannot accidentally reach the unfiltered list instead.
 *
 * It matches a name, a commercial registration number or a tax registration number. It CANNOT match an
 * individual's national ID or a phone number — both are encrypted with a random IV per value, so there
 * is no equality to test. See `customer.repository.ts#searchForPicker`.
 */
export function searchCustomers(term: string): Promise<CustomerSearchResult[]> {
  return apiGet(`/customers/search?q=${encodeURIComponent(term)}`);
}

export function listCustomers(
  filter: ListCustomersFilter = {},
): Promise<Paginated<Customer>> {
  const params = new URLSearchParams();
  if (filter.ownerUserId) params.set('ownerUserId', filter.ownerUserId);
  if (filter.status) params.set('status', filter.status);
  if (filter.search) params.set('search', filter.search);
  // Sent only when past the first page, so the common request keeps the URL
  // it always had and the server's own default decides the size.
  if (filter.page) params.set('page', String(filter.page));
  const qs = params.toString();
  return apiGet(`/customers${qs ? `?${qs}` : ''}`);
}

export function getCustomer(id: string): Promise<Customer> {
  return apiGet(`/customers/${id}`);
}

export function revealCustomerField(
  id: string,
  field: RevealableField,
  reason: string,
): Promise<{ field: RevealableField; value: string }> {
  return apiPost(`/customers/${id}/reveal-field`, { field, reason });
}

export function addUbo(customerId: string, input: CreateUboInput): Promise<Ubo> {
  return apiPost(`/customers/${customerId}/ubos`, input);
}

export function listUbos(customerId: string): Promise<Ubo[]> {
  return apiGet(`/customers/${customerId}/ubos`);
}

export function addCustomerDocument(
  customerId: string,
  input: CreateCustomerDocumentInput,
): Promise<CustomerDocument> {
  return apiPost(`/customers/${customerId}/documents`, input);
}

export function listCustomerDocuments(customerId: string): Promise<CustomerDocument[]> {
  return apiGet(`/customers/${customerId}/documents`);
}

/*
 * CORRECTING A CUSTOMER'S CONTACT DETAILS — `PATCH /customers/:id`.
 *
 * WHY THIS EXISTS AND WHY ITS ABSENCE MATTERED
 * -------------------------------------------
 * The route shipped without a web caller, which made two capabilities unreachable
 * at once (IMPROVEMENTS § 1.65). The first is the owner's own requirement: phone,
 * address and email correctable unconditionally. The second is worse, because it is
 * a gate whose precondition became unreachable — `DsrService.fulfil` refuses to
 * close a CORRECTION request until a correction has actually been RECORDED against
 * it, and this route is the only thing that records one. So a customer exercising a
 * statutory right to have their data corrected could have the request neither
 * answered nor closed.
 *
 * THE FORM MUST NOT PREFILL, AND THAT IS NOT A STYLE CHOICE
 * -------------------------------------------------------
 * `contactPhone` and `contactEmail` arrive MASKED on the detail read — they are
 * encrypted at rest and revealed through their own audited endpoint. Prefilling a
 * correction form from the displayed value would write the mask back into the
 * record as the customer's phone number. So every field starts empty, and an
 * untouched field is omitted rather than sent: the DTO's `emptyStringToUndefined`
 * makes that the same thing server-side.
 */
export interface CustomerContactCorrection {
  contactPhone?: string;
  contactEmail?: string;
  registeredAddress?: string;
  /** Why the change was made. Stored on every correction row; the service supplies
   * a neutral default when absent, which is a worse record than a real sentence. */
  reason?: string;
  /** Present only when this correction ANSWERS a statutory request. `answersRequestId`
   * is what `DsrService.fulfil` then looks for before it will close that request. */
  answersRequestType?: 'dsr';
  answersRequestId?: string;
}

export function updateCustomerContactDetails(
  customerId: string,
  input: CustomerContactCorrection,
): Promise<Customer> {
  // Only the fields actually typed. An empty string would be an instruction to
  // store an empty string, which is not what a blank box means.
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string' && v.trim() !== '') body[k] = v.trim();
  }
  return apiPatch(`/customers/${encodeURIComponent(customerId)}`, body);
}

/** At least one of the three fields carries a value — the service refuses an empty
 * correction with a 422, and a screen should not send one. */
export function hasSomethingToCorrect(input: CustomerContactCorrection): boolean {
  return [input.contactPhone, input.contactEmail, input.registeredAddress].some(
    (v) => (v ?? '').trim() !== '',
  );
}

/**
 * CORRECTING A DATE OF BIRTH OR A NATIONALITY — `PATCH /customers/:id/identifiers`.
 *
 * A SEPARATE call rather than two more fields on the one above, mirroring the api, where the
 * separation is what keeps the other six identifiers refused: `UpdateCustomerContactDto` being a
 * three-field class IS the first of the three layers the 2026-09-28 deferral's safety condition 1
 * rests on, and the owner struck that deferral for these two fields only.
 *
 * ## THIS FORM *MAY* PREFILL, UNLIKE THE CONTACT ONE — AND THE REASON IS WORTH KNOWING
 *
 * The contact form must not, because `contactPhone` and `contactEmail` arrive MASKED and prefilling
 * would write the mask back as the customer's phone number. These two arrive IN THE CLEAR and
 * deliberately so — the detail view's own comment says they *"exist to be compared against a
 * sanctions/PEP list entry, and a reviewer working a match needs to see them"*. So the displayed
 * value IS the stored value and a prefill is honest.
 *
 * It is still not prefilled here. The service refuses a correction whose every value already matches
 * the row (*"nothing to correct and nothing to re-screen"*), so a prefilled form that somebody opens
 * and submits unchanged would be a 422 rather than a no-op — and a form that starts empty cannot be
 * submitted by accident at all. That is a decision about THIS form rather than a property of the
 * data, which is the opposite of the contact case and is why it is written down.
 */
export interface CustomerIdentifierCorrection {
  /** `YYYY-MM-DD`. */
  dateOfBirth?: string;
  /** ISO 3166-1 alpha-2, upper case. */
  nationality?: string;
  /** MANDATORY here, unlike the contact correction's. Part of the record the AMLU requires retained,
   *  and the server refuses below ten characters. */
  reason: string;
  answersRequestType?: 'dsr';
  answersRequestId?: string;
}

export interface CustomerIdentifierCorrectionResult extends Customer {
  /**
   * Whether the re-screen that this correction triggers actually completed.
   *
   * FALSE is reachable: the correction row is written BEFORE the re-screen, so a screening failure
   * leaves the record intact and the check owed. It is reported rather than swallowed because a
   * screen claiming a corrected identifier was re-checked when it was not would be the overclaiming
   * shape. Nothing on the screen words it yet — the sentence for that case is one item on the
   * owner's list, and the backstop meanwhile is the screening hold, which raises
   * IDENTITY_CHANGED_SINCE_SCREENING and refuses the next decision on that file.
   */
  rescreened: boolean;
}

export function correctCustomerIdentifiers(
  customerId: string,
  input: CustomerIdentifierCorrection,
): Promise<CustomerIdentifierCorrectionResult> {
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string' && v.trim() !== '') body[k] = v.trim();
  }
  return apiPatch(
    `/customers/${encodeURIComponent(customerId)}/identifiers`,
    body,
  );
}

/** At least one identifier AND a reason long enough for the server to accept — a screen must not send
 *  a request it already knows will be refused. The floor is the api's
 *  `DECLARATION_REASON_MIN_LENGTH`; a copy, because the web cannot import from the api, and the e2e
 *  asserts the refusal so the two cannot drift silently. */
export const IDENTIFIER_CORRECTION_REASON_MIN_LENGTH = 10;

export function hasAnIdentifierToCorrect(
  input: CustomerIdentifierCorrection,
): boolean {
  const hasField = [input.dateOfBirth, input.nationality].some(
    (v) => (v ?? '').trim() !== '',
  );
  return (
    hasField &&
    input.reason.trim().length >= IDENTIFIER_CORRECTION_REASON_MIN_LENGTH
  );
}

