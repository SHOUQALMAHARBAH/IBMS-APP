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
  /**
   * 🔴 THE SIX-STATE STANDING — the SAME value `/regulatory-compliance` prints. The full walk
   * §A item 10, decision 167/17.
   *
   * REPLACED `isCurrentlyLapsed`, which was the DATE-ONLY lapse: past expiry that boolean is
   * `!renewalFiledOnTime`, and its `false` covered four renewal states — three of them EXPIRED and
   * barred — which is why this screen printed «ساري» for an office whose licence had run out.
   *
   * `null` ONLY where there is no licence term: for a brokerage office that is «no term on record»
   * and blocks new business under art. 21/a/9, and for a registered INSURANCE COMPANY it is simply
   * what having no broker licence looks like. The screen tells those apart by `organizationType`,
   * not by this field — collapsing them would report a company as being in regulatory default.
   *
   * ⚠️ `status` can never be SUSPENDED or CANCELLED here: the provider's derivation is given no
   * regulatory acts (register entry 97), so `mayNotIssue` is the one bit that reports that half.
   */
  standing: {
    status:
      | 'NO_TERM_ON_RECORD'
      | 'ACTIVE'
      | 'RENEWAL_PENDING'
      | 'EXPIRED'
      | 'SUSPENDED'
      | 'CANCELLED';
    /** What the issuance gate reads. `assertMayPractise` throws on `!mayPractise` and on nothing
     *  else, so this is the new-business block itself rather than a label for it. */
    mayPractise: boolean;
  } | null;
  /**
   * THE ONE REGULATORY FACT — register entry 97, closed. *This office may not issue.*
   *
   * TRUE when a suspension or a cancellation is standing today. Nothing behind it reaches this
   * client and nothing should: not the decision reference, the basis, the dates, the letter or the
   * kind. A sanction's contents are the office's own.
   *
   * NOT the same question as `isCurrentlyLapsed`, which is the term ARITHMETIC. A bar on a licence
   * whose dates are still valid therefore reads as `mayNotIssue` beside a future expiry, which is
   * the intent: the provider should KNOW there is a bar.
   */
  mayNotIssue: boolean;
  renewalDueBy: string | null;
  renewalFiledOnTime: boolean | null;
  licensedBranches: number;
  dormantLicensedBranches: number;
  users: number;
  activeUsers: number;
  /** THE FULL WALK §A item 11 — how many accounts have ever been used, the SAME predicate
   *  `resolveInvitationTarget` tests. The invite control reads it so it cannot be a 403.
   *  ⚠️ NOT `lastActivityAt === null`, which is a session MAX and misses somebody who set their
   *  password through the invitation link and never signed in. */
  enteredUsers: number;
  /** An OFFICE-level maximum. Never a person's sign-in. */
  lastActivityAt: string | null;
}

export function listProviderOffices(): Promise<ProviderOfficeState[]> {
  return apiGet<ProviderOfficeState[]>('/provider/offices');
}
