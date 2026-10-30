import { apiGet } from '../auth/api-client';
import type { DocumentCategory } from '../audit-trail/audit-trail-api';

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

/**
 * `GET /documents/search` — owner decision 41, the fifth picker.
 *
 * Gated on `document.read` ALONE, which is a DELIBERATE departure from the rule above and is argued in
 * the api's `common/picker-search.config.ts`. The consequence is visible on the screen rather than
 * hidden: the EXTERNAL_AUDITOR holds `document-history.read` and NOT `document.read`, so that role gets
 * no chooser and keeps the typed field — not an inbound link, since `/documents` needs
 * `document.read` too; the ids reach that role through the audit-log table on the same screen.
 * Widening this would hand a read-only
 * auditor a name search over every document in the office. That narrowness is held by
 * `picker-search-gates.e2e-spec.ts` and by `audit-trail.spec.ts`, and NOT by
 * `picker-route-reachability.mjs`, which does not see this picker at all (its screen-side map has no
 * `documentId` entry) — measured, after this file first claimed the reverse.
 *
 * `category` and `versionNumber` are the disambiguation line and are not decoration: file names repeat
 * heavily by nature, so a list of names alone cannot tell two matches apart.
 */
export interface DocumentPickerResult {
  id: string;
  fileName: string;
  /** The web's single declaration of that vocabulary, reused rather than copied a second time —
   *  `ENUM_LABEL.DocumentCategory` is total over it, so a category with no label is a type error. */
  category: DocumentCategory;
  versionNumber: number;
}

export function searchDocuments(term: string): Promise<DocumentPickerResult[]> {
  return apiGet(`/documents/search?q=${encodeURIComponent(term)}`);
}
