import type { Prisma } from '@ibms/db';

/**
 * Process 51/Part 7.1 — the broker's own CBJ regulatory license (backlog
 * Part C #51's first checkbox: "Automatically block new business issuance
 * once the license lapses"). The pure, deterministic core: the status
 * domain, the live-lapsed check shared by the gate and the view, and the
 * audit snapshot.
 *
 * `BrokerLicense` (Part 7.1 core schema) pre-existed and needs no widening —
 * `licenseNumber`/`scopeOfAuthorization`/`issuedAt`/`expiresAt`/`status`
 * already cover the record. **No migration, no seed change** —
 * `license.manage` (`[COMPLIANCE_OFFICER]`) was pre-seeded ahead of time.
 *
 * `ibms-brain/meta/context/regulatory-compliance.md`.
 */

export const BROKER_LICENSE_STATUSES = ['active', 'lapsed'] as const;
export type BrokerLicenseStatus = (typeof BROKER_LICENSE_STATUSES)[number];

/**
 * THE SINGLETON IS GONE — Module 0 item (c). Kept as a note rather than silently deleted, because
 * the shape it created is worth not reinventing.
 *
 * `BROKER_LICENSE_SINGLETON_ID = 'the-broker-license'` was used as the PRIMARY KEY, on the
 * reasoning that "a broker holds exactly one current license at a time". The reasoning was about
 * ONE office; the column is global. So there could be at most one licence row in the whole
 * database: the second office to call `create` collided on `BrokerLicense_pkey` and could never
 * hold a licence, while its `findCurrent()` returned NULL and the new-business gate read that as
 * "not blocked".
 *
 * A term is now a row, keyed by uuid and scoped by `organizationId` like everything else.
 */

/**
 * MODULE 0 ITEM (d) — THE TERM AND RENEWAL RULES, as pure functions.
 *
 * CBJ Instructions No. 9 of 2026:
 *   art. 10/b — a licence term is THREE CALENDAR YEARS ENDING 31 DECEMBER.
 *   art. 11   — the renewal application is due 45 DAYS BEFORE EXPIRY.
 *   art. 21/a/9 — practising after a licence has ended is a ground for sanction.
 */

/** Art. 11. CALENDAR days, not business days, and the reading is deliberate: the deadline is
 *  stated as a span before a fixed calendar date, and counting it in business days would move it
 *  EARLIER — making the office late for a filing the regulation would call timely. This project has
 *  already been bitten by a date rule whose error ran against the brokerage (the empty holiday
 *  calendar), so where a reading is ambiguous the literal one wins. */
export const RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY = 45;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Art. 11's deadline for THIS term's renewal application: 45 calendar days before it expires. */
export function renewalApplicationDueBy(expiresAt: Date): Date {
  return new Date(
    expiresAt.getTime() -
      RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY * MS_PER_DAY,
  );
}

/**
 * Was the renewal application filed BY art. 11's deadline?
 *
 * `false` when nothing was filed at all — which is the case that matters, because an office that
 * filed nothing expires on 31 December while one that filed on time does not.
 */
export function renewalFiledOnTime(term: {
  expiresAt: Date;
  renewalRequestedAt: Date | null;
}): boolean {
  if (!term.renewalRequestedAt) return false;
  return (
    term.renewalRequestedAt.getTime() <=
    renewalApplicationDueBy(term.expiresAt).getTime()
  );
}

/**
 * Art. 10/b — a term ends on 31 DECEMBER.
 *
 * Read off the UTC date because that is how `parseCalendarDate` stores a whole-day field; using
 * local getters would make the answer depend on the server's timezone, which for a date printed on
 * a certificate is nonsense.
 */
export function expiryIsEndOfCalendarYear(expiresAt: Date): boolean {
  return expiresAt.getUTCMonth() === 11 && expiresAt.getUTCDate() === 31;
}

/**
 * The expiry art. 10/b implies for a term issued on this date: 31 December of the issue year + 2,
 * i.e. three calendar years counting the year of issue. Null when no issue date was recorded.
 *
 * INFORMATIONAL ONLY — it is deliberately NOT a second warning condition. The brief names exactly
 * one thing to warn about (an expiry that is not a 31 December), and "three calendar years" is
 * genuinely ambiguous for a term issued mid-year: whether 2026-06-15 should end 2028-12-31 or
 * 2029-12-31 is a question for the regulator, not something to infer and then warn on. Surfaced so
 * a screen can show it beside the entered date; nothing refuses on it.
 */
export function expectedExpiryForThreeYearTerm(
  issuedAt: Date | null,
): Date | null {
  if (!issuedAt) return null;
  return new Date(Date.UTC(issuedAt.getUTCFullYear() + 2, 11, 31));
}

/**
 * Whether the license should be treated as lapsed **right now** — an
 * explicit manual `status: 'lapsed'` (e.g. a CBJ suspension ahead of the
 * calendar expiry) OR the calendar expiry having already passed, whichever
 * fires first. Pure, `now` injected so the gate and the view share one
 * clock with their tests.
 *
 * Deliberately does **not** rely solely on the stored `status` column being
 * kept fresh by a background sweep — the #16 `@code-reviewer` MAJOR lesson
 * ("a control that fires only when a human/sweep configured data in the
 * right order first is procedural, not structural") applies directly here:
 * `PolicyService.place()`'s block must be correct the INSTANT `expiresAt`
 * passes, not only after some future scheduled sweep has had a chance to
 * run and flip the column. There is therefore no `BrokerLicenseSweepScheduler`
 * in this codebase at all — the live check below is both the gate's
 * decision and the read view's derived flag, so there is nothing for a
 * sweep to keep in sync.
 */
export function isBrokerLicenseCurrentlyLapsed(
  license: {
    status: string;
    expiresAt: Date;
    renewalRequestedAt: Date | null;
  },
  now: Date,
): boolean {
  // A MANUAL lapse outranks everything. Module 0 item (d) kept this first deliberately: a CBJ
  // suspension is not cured by having filed a renewal application, and ordering the checks the
  // other way would let a timely filing paper over a regulator's own intervention.
  if (license.status === 'lapsed') return true;

  // Still inside the term.
  if (license.expiresAt.getTime() > now.getTime()) return false;

  /*
   * PAST EXPIRY — art. 11's by-operation-of-law extension, item (d).
   *
   * After 31 December an office whose renewal application was filed ON TIME stays valid until the
   * regulator's decision issues; an office that filed nothing, or filed late, expires.
   *
   * "Until the decision issues" needs no extra column: the decision IS the next term being
   * recorded, and a later term wins `pickCurrentTerm` the moment it exists — so this branch is
   * only ever reached for the office's LATEST term, which by definition has no decision after it
   * yet. A `renewalDecidedAt` column would be a second place for that fact to live and to drift
   * from the series it is derived from.
   */
  return !renewalFiledOnTime(license);
}

/**
 * EXPIRED BUT STILL VALID, by art. 11 rather than by its own dates.
 *
 * Its own flag rather than being folded into `isCurrentlyLapsed`, because the two answer different
 * questions and a screen needs both: "may this office place business" (it may) and "is this term
 * past its printed expiry" (it is). Collapsing them would leave an officer looking at an expiry in
 * the past with nothing explaining why the system is content.
 */
export function isValidByOperationOfLaw(
  license: {
    status: string;
    expiresAt: Date;
    renewalRequestedAt: Date | null;
  },
  now: Date,
): boolean {
  if (license.status === 'lapsed') return false;
  if (license.expiresAt.getTime() > now.getTime()) return false;
  return renewalFiledOnTime(license);
}

/** ONE TERM as stored. */
export interface BrokerLicenseRow {
  id: string;
  licenseNumber: string;
  scopeOfAuthorization: string | null;
  issuedAt: Date | null;
  expiresAt: Date;
  status: string;
  /** Mandatory — see the model. A term with no certificate is unrepresentable. */
  certificateDocumentId: string;
  /** When the renewal application for the NEXT term was filed, or null. Item (d) reads this. */
  renewalRequestedAt: Date | null;
}

/**
 * THE OFFICE'S CURRENT TERM — the one with the latest expiry.
 *
 * Latest expiry rather than "the one covering today", because those differ exactly when it matters:
 * between filing a renewal (due 45 days before expiry, art. 11) and the old term running out, an
 * office legitimately holds TWO terms, and the one that decides whether it may practise tomorrow is
 * the newer one. Picking "the term covering today" would answer with the outgoing term and report
 * an office as lapsing when it has already been renewed.
 *
 * Returns null for an office with no terms at all. That is NOT the same as "not blocked" — see
 * `PolicyService.assertLicenseNotLapsed`, where absence blocks.
 */
export function pickCurrentTerm<T extends { expiresAt: Date }>(
  terms: readonly T[],
): T | null {
  let current: T | null = null;
  for (const t of terms) {
    if (!current || t.expiresAt.getTime() > current.expiresAt.getTime()) {
      current = t;
    }
  }
  return current;
}

export interface BrokerLicenseView {
  id: string;
  licenseNumber: string;
  scopeOfAuthorization: string | null;
  issuedAt: string | null;
  expiresAt: string;
  status: string;
  /** Live-derived — see `isBrokerLicenseCurrentlyLapsed`. May be `true` even
   * when `status` still reads `"active"`, if nothing has renewed/marked it
   * since `expiresAt` passed. */
  isCurrentlyLapsed: boolean;
  certificateDocumentId: string;
  renewalRequestedAt: string | null;
  /** Item (d). Art. 11's deadline for this term's renewal application. */
  renewalDueBy: string;
  /** Whether the application was filed by that deadline. False when none was filed. */
  renewalFiledOnTime: boolean;
  /** Past its printed expiry yet still valid, because a timely application is pending (art. 11). */
  validByOperationOfLaw: boolean;
  /** Art. 10/b — false means the entered expiry is not a 31 December. A WARNING, never a block:
   *  the date is entered as printed on the certificate and the certificate is the authority. */
  expiryIsEndOfCalendarYear: boolean;
  /** Informational only — see `expectedExpiryForThreeYearTerm`. Nothing refuses on it. */
  expectedExpiryForThreeYearTerm: string | null;
}

export function deriveBrokerLicenseView(
  row: BrokerLicenseRow,
  now: Date,
): BrokerLicenseView {
  return {
    id: row.id,
    licenseNumber: row.licenseNumber,
    scopeOfAuthorization: row.scopeOfAuthorization,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
    isCurrentlyLapsed: isBrokerLicenseCurrentlyLapsed(row, now),
    certificateDocumentId: row.certificateDocumentId,
    renewalRequestedAt: row.renewalRequestedAt
      ? row.renewalRequestedAt.toISOString()
      : null,
    renewalDueBy: renewalApplicationDueBy(row.expiresAt).toISOString(),
    renewalFiledOnTime: renewalFiledOnTime(row),
    validByOperationOfLaw: isValidByOperationOfLaw(row, now),
    expiryIsEndOfCalendarYear: expiryIsEndOfCalendarYear(row.expiresAt),
    expectedExpiryForThreeYearTerm:
      expectedExpiryForThreeYearTerm(row.issuedAt)?.toISOString() ?? null,
  };
}

/** CREATE/UPDATE audit `afterValue` — no free text beyond
 * `scopeOfAuthorization`, an internal regulatory-scope label Compliance
 * writes about the broker's own authorization (not customer data, not a
 * field a customer could paste anything into) — included verbatim, unlike
 * the `NO_FULL_ACCOUNT_NUMBER`-guarded customer-facing free-text fields
 * elsewhere in this codebase. */
export function brokerLicenseAuditSnapshot(
  input: BrokerLicenseRow,
): Prisma.InputJsonObject {
  return {
    brokerLicenseId: input.id,
    licenseNumber: input.licenseNumber,
    scopeOfAuthorization: input.scopeOfAuthorization,
    issuedAt: input.issuedAt ? input.issuedAt.toISOString() : null,
    expiresAt: input.expiresAt.toISOString(),
    status: input.status,
    certificateDocumentId: input.certificateDocumentId,
    renewalRequestedAt: input.renewalRequestedAt
      ? input.renewalRequestedAt.toISOString()
      : null,
  };
}
