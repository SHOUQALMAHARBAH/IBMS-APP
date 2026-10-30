/**
 * THE INSURANCE COMPANY'S LICENCE TERM — batch 5 group 7d.
 *
 * The term is STORED (issue date, expiry, a series of them) so that the standing is DERIVABLE. The
 * standing is shown on the company's own record and nowhere else, and it gates nothing.
 *
 * ## THIS SUPERSEDES TWO RECORDED NOTES, AND THEY SAID THE OPPOSITE
 *
 * Both are quoted rather than quietly overwritten, because each carried a reason:
 *
 *   * `schema.prisma` on `insurerLicenseCertificateDocumentId`: *"On the organization rather than on
 *     a term, because the v2 insurer sheet carries a licence number and a licensing authority and NO
 *     issue or expiry date — unlike the broker sheet, whose licence item (c) made a series of terms.
 *     Inventing a term series would be building a structure for dates the form never collects."*
 *   * `register-insurance-company.dto.ts` #10: *"A SINGLE number, not a series of terms: the insurer
 *     sheet carries no issue or expiry date, unlike the broker sheet, so there is no term to model."*
 *
 * The owner's 7d brief asks for the term, and the reason she asks is in the brief itself: without an
 * expiry no standing can be derived at all. So the premise that moved is not the sheet — it is that
 * the dates are now wanted. **The consequence is that the registration form has to collect them**,
 * or the columns would be unpopulatable by any path, which is the capability-nobody-can-exercise
 * class this module has measured twice. Both notes are corrected where they sit.
 *
 * ## THE STANDING IS DERIVED AND HAS NO COLUMN — WHICH WAS ALREADY THE DECISION
 *
 * `register-insurance-company.dto.ts` #12 records it: *"`license_status_id` — DERIVED. Decision 71
 * and the dictionary's correction 3: «حالة الترخيص لا تُخزَّن». There is no column and there must
 * not be one."* 7d agrees with that half exactly, so nothing changes about it.
 *
 * ## IT BORROWS NO ARTICLE FROM THE BROKER'S RULE, AND THAT IS THE LOAD-BEARING DECISION
 *
 * `isBrokerLicenseCurrentlyLapsed` is richer than what follows, and deliberately not reused. Its
 * extra behaviour comes from articles about BROKERS:
 *
 *   * art. 10/b — a term ends on 31 December, which is why the broker rule warns on a date that is
 *     not one;
 *   * art. 11 — the 45-day renewal filing, and the by-operation-of-law extension that follows from
 *     it, which is why the broker rule takes `renewalRequestedAt`;
 *   * art. 21/a/9 — why a broker with NO term on record is BLOCKED from new business.
 *
 * Nothing in this product establishes that any of those governs an insurance company. Applying them
 * would be asserting a regulatory reading nobody has made — the thing `broker-license-scope.config.ts`
 * and the retention floors both refuse to do. So this derivation is arithmetic over the dates and
 * nothing else, and it carries no citation because it needs none.
 *
 * ## AND IT GATES NOTHING, WHICH IS ASSERTED AS AN ABSENCE
 *
 * MEASURED before building: `Organization.insurerLicenseNumber` has four non-spec readers — the
 * company-record read and its view, the registration write, and the two screens — and **not one of
 * them is a gate**. 7d adds none. We hold no article gating an office's dealings with a company
 * whose licence has lapsed, and `insurance-company-license.inventory.spec.ts` asserts that no
 * service refuses, warns or branches on this standing.
 *
 * ## THE REOPENING CONDITION
 *
 * When the contract-request flow exists — the gateway module, which is not built — whether an
 * expired recorded licence declares itself at that point is the owner's decision. Not a refusal
 * inferred from an expiry, and not a warning added because one seemed useful: the question is
 * whether a broker about to request cover from a company whose recorded term has run out should be
 * told. That is hers, and this file is where it is written down so it is asked rather than assumed.
 */

export const INSURANCE_COMPANY_LICENSE_STANDINGS = [
  /** No term has ever been recorded. NOT the same as expired — see below. */
  'NO_TERM_ON_RECORD',
  /** The latest term's expiry is in the future. */
  'CURRENT',
  /** The latest term's expiry has passed. */
  'EXPIRED',
] as const;

export type InsuranceCompanyLicenseStanding =
  (typeof INSURANCE_COMPANY_LICENSE_STANDINGS)[number];

export interface InsuranceCompanyLicenseTermInput {
  licenseNumber: string;
  issuedAt: Date | null;
  expiresAt: Date;
}

export interface InsuranceCompanyLicenseStandingView {
  standing: InsuranceCompanyLicenseStanding;
  /** The term the standing was derived FROM, so a reader can check the arithmetic. */
  currentTerm: {
    licenseNumber: string;
    issuedAt: string | null;
    expiresAt: string;
  } | null;
  /** How many terms are on record — the series, reported rather than implied. */
  termCount: number;
}

/**
 * The latest term by expiry — NOT "the term covering today".
 *
 * The same reading `pickCurrentTerm` uses for the broker, and for the same reason: between a renewal
 * being recorded and the old term running out a company legitimately holds TWO, and the newer one is
 * the one that describes its standing. Picking the covering term would report a renewed company as
 * expiring.
 *
 * The tie-break is the LICENCE NUMBER rather than an insertion order, so the answer cannot depend on
 * which of two same-expiry terms was typed first — the `orderBy` lesson from
 * `findActiveUserIdsWithPermission`, where a consumer taking `[0]` imposed an ordering requirement
 * nothing type-checked.
 */
export function pickCurrentCompanyTerm<
  T extends InsuranceCompanyLicenseTermInput,
>(terms: readonly T[]): T | null {
  if (terms.length === 0) return null;
  return [...terms].sort((a, b) => {
    const byExpiry = b.expiresAt.getTime() - a.expiresAt.getTime();
    if (byExpiry !== 0) return byExpiry;
    return a.licenseNumber.localeCompare(b.licenseNumber);
  })[0];
}

/**
 * The standing, derived.
 *
 * THREE STATES, NOT TWO, AND THE THIRD IS THE ONE A CARELESS VERSION LOSES. "No term on record" is a
 * missing fact about our own records; "expired" is a statement about the company's licence. The
 * broker side already learned this the hard way — `isCurrentlyLapsed === null` means no term and
 * collapsing it into `true` reports an expiry nobody recorded. Here the stakes are lower because
 * nothing is gated, and the distinction is kept anyway: the screen must not tell a reader that a
 * company's licence has expired when what is true is that we never wrote one down.
 *
 * `now` is a parameter so the boundary is provable in a unit test without a clock.
 */
export function deriveCompanyLicenseStanding(
  terms: readonly InsuranceCompanyLicenseTermInput[],
  now: Date,
): InsuranceCompanyLicenseStandingView {
  const current = pickCurrentCompanyTerm(terms);
  if (current === null) {
    return { standing: 'NO_TERM_ON_RECORD', currentTerm: null, termCount: 0 };
  }
  return {
    // INCLUSIVE of the expiry instant: a term expiring at this moment is still CURRENT, which is the
    // same direction `renewalFiledOnTime` chose for the broker's deadline. A `<` here would make a
    // company expired on the last day of its own licence.
    standing:
      current.expiresAt.getTime() >= now.getTime() ? 'CURRENT' : 'EXPIRED',
    currentTerm: {
      licenseNumber: current.licenseNumber,
      issuedAt:
        current.issuedAt === null ? null : current.issuedAt.toISOString(),
      expiresAt: current.expiresAt.toISOString(),
    },
    termCount: terms.length,
  };
}
