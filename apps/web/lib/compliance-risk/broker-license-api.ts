// Module 0 item (c) — this OFFICE's CBJ licence, as a SERIES OF TERMS.
//
// It used to be a singleton, and the correction matters: the id it was keyed by was the table's
// PRIMARY KEY, so there was one licence row for the whole platform rather than one per office. The
// second office to create one collided on the primary key and could never hold a licence, while its
// own new-business gate then read the absence as "not blocked".
//
// ⚠️ THESE INTERFACES ARE HAND-COPIED OVER AN HTTP RESPONSE AND TYPESCRIPT CANNOT CHECK THEM.
// That is the drift class that broke the customer-import result panel: the API replaced two fields
// with one, the web kept reading the old names, both were `undefined`, and the screen threw during
// render with nothing failing at compile time. When `BrokerLicenseView` or the `GET /broker-license`
// envelope changes in apps/api, this file has to change in the same commit.

import { apiGet, apiPost } from '../auth/api-client';

// `BrokerLicenseStatus` IS GONE: the api stopped sending it when the column was dropped, and a
// hand-copied type for a field nothing sends is how a screen starts indexing on `undefined`.

/** ONE TERM. */
export interface BrokerLicense {
  id: string;
  licenseNumber: string;
  scopeOfAuthorization: string | null;
  issuedAt: string | null;
  expiresAt: string;
  isCurrentlyLapsed: boolean;
  /** Mandatory — a term cannot exist without its certificate. */
  certificateDocumentId: string;
  /** When the renewal application for the NEXT term was filed, or null. */
  renewalRequestedAt: string | null;
  /** Module 0 item (d) — art. 11's deadline for this term's renewal application (45 calendar
   *  days before expiry). */
  renewalDueBy: string;
  /** Whether the application was filed by that deadline. False when none was filed. */
  renewalFiledOnTime: boolean;
  /** Past its printed expiry yet STILL VALID, because a timely application is pending a decision.
   *  NOT art. 11 — that article contains no extension; this is the owner's decision.
   *  See `RENEWAL_PENDING_RULE_BASIS` in the api's broker-license.config.ts.
   *  Its own field rather than folded into `isCurrentlyLapsed`, because a screen showing an expiry
   *  in the past has to be able to explain why the system is content. */
  validPendingRenewalDecision: boolean;
  /** Art. 10/b — false means the entered expiry is not a 31 December. A WARNING TO VERIFY, never
   *  a block: the date is entered as printed on the certificate and the certificate is the
   *  authority. */
  expiryIsEndOfCalendarYear: boolean;
  /** Informational only. Nothing refuses on it — see the api config for why three-calendar-years
   *  is not a second warning condition. */
  expectedExpiryForThreeYearTerm: string | null;
  /** Art. 10/b — whether the entered expiry matches the three-year term. NULL means no issue
   *  date on record, which is NOT a mismatch. A warning on screen; nothing is blocked. */
  expiryMatchesThreeYearTerm: boolean | null;
}

/**
 * What `GET /broker-license` answers.
 *
 * `current` is null for an office holding no licence, and the route does NOT 404 on that any more:
 * it is a real state the screen has to render, and it is also the state that BLOCKS new business
 * (CBJ Instructions No. 9 of 2026, art. 21/a/9).
 */
export interface BrokerLicenseSeries {
  current: BrokerLicense | null;
  terms: BrokerLicense[];
  /**
   * THE ONE ANSWER the api derives and the gate enforces — six states plus `mayPractise`.
   *
   * It replaces the stored `status` this file used to carry. That field was the third of three
   * answers to "is this office licensed", and the screen rendered it BESIDE the live-derived
   * `isCurrentlyLapsed`, so a reader saw two answers on one row.
   *
   * HAND-COPIED over HTTP like everything else here, so when the api view changes this type, the
   * screen and every Playwright mock move in the SAME commit.
   */
  /**
   * The renewal notice, derived by the api from the current term's own expiry — 45 days out, again
   * at 30, then continuing until the date passes.
   *
   * Nothing is stored behind it, so there is no "already notified" state to go stale, and
   * `renewalFiled` is reported BESIDE the stage rather than suppressing it: a filing is not a
   * decision, and the block lifts on the new term being recorded with its certificate.
   */
  renewalNotice: {
    stage: 'NONE' | 'FIRST' | 'SECOND' | 'CONTINUING' | 'EXPIRED';
    daysToExpiry: number | null;
    expiresAt: string | null;
    applicationDueBy: string | null;
    renewalFiled: boolean;
  };
  standing: {
    status:
      | 'NO_TERM_ON_RECORD'
      | 'ACTIVE'
      | 'RENEWAL_PENDING'
      | 'EXPIRED'
      | 'SUSPENDED'
      | 'CANCELLED';
    mayPractise: boolean;
    standingActDecisionRef: string | null;
    deemedCancelledUnderArticle14C: boolean;
  };
}

export interface CreateOrRenewBrokerLicenseInput {
  licenseNumber: string;
  scopeOfAuthorization?: string;
  issuedAt?: string;
  expiresAt: string;
  /** Required. The API refuses a term with no certificate, and so does the column behind it. */
  certificateFileName: string;
  certificateStorageRef: string;
}

export function getBrokerLicense(): Promise<BrokerLicenseSeries> {
  return apiGet('/broker-license');
}

export function createBrokerLicense(
  input: CreateOrRenewBrokerLicenseInput,
): Promise<BrokerLicense> {
  return apiPost('/broker-license', input);
}

/** APPENDS the next term. It does not overwrite the current one. */
export function renewBrokerLicense(
  input: CreateOrRenewBrokerLicenseInput,
): Promise<BrokerLicense> {
  return apiPost('/broker-license/renew', input);
}

/** Records that the renewal application has been filed. Write-once: art. 11 measures lateness from
 *  this date, so the API refuses a second call rather than moving it. Omit the date for today. */
export function recordRenewalRequest(input: {
  requestedAt?: string;
}): Promise<BrokerLicense> {
  return apiPost('/broker-license/renewal-requested', input);
}

/**
 * The office records a decision the REGULATOR took about its licence.
 *
 * This replaces `markBrokerLicenseLapsed`, which posted an EMPTY BODY to `/broker-license/mark-lapsed`
 * and flipped a two-value column — so the office record of a CBJ suspension carried no basis, no
 * effective date, no decision reference and no letter.
 *
 * THERE IS NO REGULATOR IN THIS SYSTEM. The CBJ acts outside this product; what this writes is the
 * office own record of a letter it received.
 *
 * Returns the RECOMPUTED standing, so a caller never has to guess what the act did to it.
 */
export function recordRegulatoryAction(input: {
  kind: 'SUSPENSION' | 'CANCELLATION' | 'REINSTATEMENT';
  basis: 'BROKER_REQUEST' | 'SANCTION';
  effectiveFrom: string;
  decisionRef: string;
  documentId?: string;
  suspendedUntil?: string;
}): Promise<BrokerLicenseSeries['standing']> {
  return apiPost('/broker-license/regulatory-actions', input);
}
