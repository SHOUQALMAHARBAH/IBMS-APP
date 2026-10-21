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
/*
 * `BROKER_LICENSE_STATUSES` AND `BrokerLicenseStatus` ARE GONE, with the column they described.
 *
 * They were `['active', 'lapsed']` — two values against `deriveLicenseStanding`'s six, written by
 * one route that took no body at all, so a CBJ suspension was recorded as a flag with no basis, no
 * date, no reference and no letter. The standing is derived now and a regulator decision is a
 * `RegulatoryAction` row.
 */

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

/**
 * THE BASIS FOR "A TIMELY RENEWAL KEEPS THE LICENCE ALIVE PAST ITS PRINTED EXPIRY".
 *
 * Quoted verbatim wherever that rule is explained, because it replaced a CITATION THAT WAS FALSE.
 * Until 2026-10-12 this rule cited art. 11 — in code, in test names, and in a sentence a user could
 * read on screen in both languages. Art. 11 is one sentence: file a renewal every three years, 45
 * days before expiry. It contains no extension, and no other article of Instructions No. 9 of 2026
 * does either.
 *
 * The rule itself STANDS — it is the owner's decision, answering the text's silence, and it is
 * conditioned on the renewal having been filed on time. What was removed is the claim of legal
 * authority behind it:
 *
 *   Owner's decision. No provision in Instructions No. 9 of 2026. Supported by analogy only with
 *   art. 8/d of Law No. 12 of 2021 (deemed approval for insurance companies), which does not
 *   extend to brokers by its terms. Pending arts. 82 and 109 of that law and the CBJ renewal
 *   application form.
 *
 * Against the analogy stands art. 5/a of the same law: no person may practise insurance business
 * without the required licence. That is why the rule is conditioned on a TIMELY filing and is not
 * a general grace period.
 */
export const RENEWAL_PENDING_RULE_BASIS =
  "Owner's decision. No provision in Instructions No. 9 of 2026. Supported by analogy only with " +
  'art. 8/d of Law No. 12 of 2021 (deemed approval for insurance companies), which does not ' +
  'extend to brokers by its terms. Pending arts. 82 and 109 of that law and the CBJ renewal ' +
  'application form.';

/** Art. 11 — and this one IS art. 11: the filing deadline is the article's whole content.
 *  CALENDAR days, not business days, and the reading is deliberate: the deadline is
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
 * The expiry art. 10/b requires for a term issued on this date: 31 December of the issue year + 2.
 * Null when no issue date was recorded.
 *
 * ## IT IS NOT AMBIGUOUS. ITEM (d) SAID IT WAS, AND THE TEXT SAYS OTHERWISE — corrected 2026-10-13.
 *
 * This function used to carry the note: *"'three calendar years' is genuinely ambiguous for a term
 * issued mid-year: whether 2026-06-15 should end 2028-12-31 or 2029-12-31 is a question for the
 * regulator"*, and on that basis it was INFORMATIONAL ONLY and warned about nothing.
 *
 * Art. 10/b answers it in its own sentence:
 *
 *   يُمنح الترخيص لمدة ثلاث سنوات ميلادية تنتهي في الحادي والثلاثين من شهر كانون الأول
 *   ويعتبر جزء السنة الميلادية لهذه الغاية سنة
 *
 *   "The licence is granted for three calendar years ending on 31 December, AND PART OF A CALENDAR
 *   YEAR IS CONSIDERED, FOR THIS PURPOSE, A YEAR."
 *
 * So the year of issue counts as the first year however late in it the licence was granted, and a
 * term issued 2026-06-15 ends 2028-12-31. The arithmetic here was already right; what was wrong was
 * the claim that nobody could know, which is why this is a comment-and-consequence change rather
 * than a formula change.
 *
 * The CONSEQUENCE is `expiryMatchesThreeYearTerm` below: the screen now says when the entered
 * expiry disagrees with art. 10/b. It WARNS and never blocks, for the reason item (d) gave and
 * which still holds — the certificate is the authority, and a date entered as printed on it stands.
 */
export function expectedExpiryForThreeYearTerm(
  issuedAt: Date | null,
): Date | null {
  if (!issuedAt) return null;
  return new Date(Date.UTC(issuedAt.getUTCFullYear() + 2, 11, 31));
}

/**
 * Does the entered expiry match what art. 10/b requires for this issue date?
 *
 * `null` when no issue date was recorded — which is NOT `false`. "The office did not record when
 * the licence was issued" and "the expiry disagrees with the regulation" are different facts, and
 * reporting the first as the second would accuse an office of a regulatory discrepancy on the
 * strength of a missing field. The same three-state treatment as `isCurrentlyLapsed`.
 */
export function expiryMatchesThreeYearTerm(term: {
  issuedAt: Date | null;
  expiresAt: Date;
}): boolean | null {
  const expected = expectedExpiryForThreeYearTerm(term.issuedAt);
  if (!expected) return null;
  return expected.getTime() === term.expiresAt.getTime();
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
    expiresAt: Date;
    renewalRequestedAt: Date | null;
  },
  now: Date,
): boolean {
  /*
   * THE MANUAL-LAPSE BRANCH IS GONE, AND ITS RULE MOVED RATHER THAN BEING LOST.
   *
   * It read `if (license.status === 'lapsed') return true;` and its comment said why it came first:
   * *"a CBJ suspension is not cured by having filed a renewal application, and ordering the checks
   * the other way would let a timely filing paper over a regulator's own intervention."* That
   * reasoning is right and is now enforced one level up, where a regulator's act is modelled
   * properly: `deriveLicenseStanding` folds `RegulatoryAction` BEFORE it reaches the term
   * arithmetic, and its own header states the precedence.
   *
   * The column it read is dropped. It was a two-value flag with no basis, no effective date, no
   * decision reference and no document — the third of three answers to "is this office licensed",
   * and the one `docs/deferred-register.md` entry 12 said to collapse once the acts had a writer.
   * They do now (`POST /broker-license/regulatory-actions`).
   */

  // Still inside the term.
  if (license.expiresAt.getTime() > now.getTime()) return false;

  /*
   * PAST EXPIRY — THE RENEWAL-PENDING RULE. See `RENEWAL_PENDING_RULE_BASIS` above: this is the
   * OWNER'S DECISION, not art. 11, and the citation that stood here was false.
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
 * EXPIRED BUT STILL VALID, because a timely renewal application is pending a decision.
 *
 * NOT "by operation of law" — that was the name until 2026-10-12 and it asserted in an identifier
 * exactly the legal authority that does not exist. See `RENEWAL_PENDING_RULE_BASIS`.
 *
 * Its own flag rather than being folded into `isCurrentlyLapsed`, because the two answer different
 * questions and a screen needs both: "may this office place business" (it may) and "is this term
 * past its printed expiry" (it is). Collapsing them would leave an officer looking at an expiry in
 * the past with nothing explaining why the system is content.
 */
export function isValidPendingRenewalDecision(
  license: {
    expiresAt: Date;
    renewalRequestedAt: Date | null;
  },
  now: Date,
): boolean {
  // The manual-lapse guard moved with the column — see `isBrokerLicenseCurrentlyLapsed` above. A
  // standing act is now what stops this branch, in `deriveLicenseStanding`, which checks the acts
  // before it ever asks about a pending renewal.
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
  /** Live-derived — see `isBrokerLicenseCurrentlyLapsed`. There is no stored status to disagree
   * with it any more: that column was the third of three answers to "is this office licensed" and
   * was dropped once `RegulatoryAction` gained a writer. */
  isCurrentlyLapsed: boolean;
  certificateDocumentId: string;
  renewalRequestedAt: string | null;
  /** Item (d). Art. 11's deadline for this term's renewal application. */
  renewalDueBy: string;
  /** Whether the application was filed by that deadline. False when none was filed. */
  renewalFiledOnTime: boolean;
  /** Past its printed expiry yet still valid, because a timely application is pending a decision.
   *  The owner's decision, NOT art. 11 — see `RENEWAL_PENDING_RULE_BASIS`. */
  validPendingRenewalDecision: boolean;
  /** Art. 10/b — false means the entered expiry is not a 31 December. A WARNING, never a block:
   *  the date is entered as printed on the certificate and the certificate is the authority. */
  expiryIsEndOfCalendarYear: boolean;
  /** The expiry art. 10/b requires for this issue date. Null when no issue date was recorded. */
  expectedExpiryForThreeYearTerm: string | null;
  /** Whether the entered expiry matches it. NULL means no issue date on record, which is not the
   *  same as a mismatch — see `expiryMatchesThreeYearTerm`. A WARNING on screen, never a block. */
  expiryMatchesThreeYearTerm: boolean | null;
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
    isCurrentlyLapsed: isBrokerLicenseCurrentlyLapsed(row, now),
    certificateDocumentId: row.certificateDocumentId,
    renewalRequestedAt: row.renewalRequestedAt
      ? row.renewalRequestedAt.toISOString()
      : null,
    renewalDueBy: renewalApplicationDueBy(row.expiresAt).toISOString(),
    renewalFiledOnTime: renewalFiledOnTime(row),
    validPendingRenewalDecision: isValidPendingRenewalDecision(row, now),
    expiryIsEndOfCalendarYear: expiryIsEndOfCalendarYear(row.expiresAt),
    expectedExpiryForThreeYearTerm:
      expectedExpiryForThreeYearTerm(row.issuedAt)?.toISOString() ?? null,
    expiryMatchesThreeYearTerm: expiryMatchesThreeYearTerm(row),
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
    certificateDocumentId: input.certificateDocumentId,
    renewalRequestedAt: input.renewalRequestedAt
      ? input.renewalRequestedAt.toISOString()
      : null,
  };
}
