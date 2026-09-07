// Process 3-4 — Customer Acquisition/Onboarding. Talks to apps/api's
// customer module (customer.controller.ts). Mirrors lib/prospect/
// prospect-api.ts's conventions (thin typed wrappers over apiGet/apiPost).

import { apiGet, apiPost } from '../auth/api-client';

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
  registrationNumber?: string;
  taxRegistrationNumber?: string;
  registeredAddress?: string;
  natureOfBusiness?: string;
  contactPhone: string;
  contactEmail: string;
  languagePreference: LanguagePreference;
  prospectId?: string;
}

export interface ListCustomersFilter {
  ownerUserId?: string;
  status?: CustomerStatus;
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

export function listCustomers(filter: ListCustomersFilter = {}): Promise<Customer[]> {
  const params = new URLSearchParams();
  if (filter.ownerUserId) params.set('ownerUserId', filter.ownerUserId);
  if (filter.status) params.set('status', filter.status);
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
