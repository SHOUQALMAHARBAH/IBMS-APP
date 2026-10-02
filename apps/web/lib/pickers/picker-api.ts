import { apiGet } from '../auth/api-client';

/**
 * THE FOUR PICKER SEARCHES added 2026-10-02 — insurer, policy, user, branch.
 *
 * Each closes a measured defect: 32 identifiers across 20 screens had to be TYPED IN, nine of them into
 * a required field, which means those screens could not be used at all without pasting a uuid from
 * somewhere else (`docs/identifier-columns-measured.md`). The fix was already in the tree — the one
 * field built for customers the day before — pointed at a different entity.
 *
 * ## Every route is gated on ANY OF the permissions of the screens that use it
 *
 * The owner's rule, and the API is where it is enforced (`common/picker-search.config.ts`). It exists
 * because the opposite shipped twice: `GET /employees/search` was gated on the national-ID reveal, so
 * an Executive could not find an employee; and `GET /customers/search` was gated on `customer.read`, so
 * the DPO could not find a customer on the DSR screen. Both are measured, both are fixed, and
 * `scripts/measurements/picker-route-reachability.mjs` is what re-checks it.
 *
 * ## The floors differ per entity, deliberately
 *
 * Three characters for a customer or a policy (each set is the whole business), two for an employee,
 * one for an insurer, a user or a branch. The number is a judgement about how much of THAT set one
 * keystroke may return, and it must match the server's or the field either sends a request it knows
 * will 400 or withholds one the server would have answered. The authority is `PICKER_MIN_CHARS` in the
 * API; `ENTITY_SOURCES` carries the matching value per source.
 */

/** `GET /insurers/search` — both name forms, so the component can translate at render. */
export interface InsurerPickerResult {
  id: string;
  name: string;
  nameAr: string | null;
}

export function searchInsurers(term: string): Promise<InsurerPickerResult[]> {
  return apiGet(`/insurers/search?q=${encodeURIComponent(term)}`);
}

/**
 * `GET /policies/search`.
 *
 * `policyNumber` is NULLABLE and that is a real state: a policy is placed before it is issued, and the
 * number arrives with issuance. Such a row is findable by its customer's name, and the picker says the
 * number is not yet assigned rather than rendering a blank that reads like a data fault.
 */
export interface PolicyPickerResult {
  id: string;
  policyNumber: string | null;
  customerLegalName: string;
  insuranceLine: string;
  status: string;
}

export function searchPolicies(term: string): Promise<PolicyPickerResult[]> {
  return apiGet(`/policies/search?q=${encodeURIComponent(term)}`);
}

/**
 * `GET /admin/users/search` — an id and the name a colleague would recognise, and nothing else.
 *
 * No email and no role list, following `GET /audit-trail/actors`: an email beside every name puts a
 * contact list in front of readers whose question was only "who owns this record".
 */
export interface UserPickerResult {
  id: string;
  name: string;
}

export function searchUsers(term: string): Promise<UserPickerResult[]> {
  return apiGet(`/admin/users/search?q=${encodeURIComponent(term)}`);
}

/**
 * `GET /admin/branches/search` — live branches only.
 *
 * Its own route rather than a widened `GET /admin/branches`: that one is an administrative register
 * returning deactivated branches too, and widening its gate to the ten codes these eleven screens carry
 * would hand nine roles an administration screen's data to serve a dropdown.
 */
export interface BranchPickerResult {
  id: string;
  name: string;
  nameAr: string | null;
}

export function searchBranches(term: string): Promise<BranchPickerResult[]> {
  return apiGet(`/admin/branches/search?q=${encodeURIComponent(term)}`);
}
