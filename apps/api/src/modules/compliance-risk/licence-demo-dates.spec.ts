import { describe, expect, it } from 'vitest';

import {
  deriveRenewalUnderStudy,
  expectedExpiryForThreeYearTerm,
  expiryMatchesThreeYearTerm,
  isBrokerLicenseCurrentlyLapsed,
} from './broker-license.config';
import type { LicenceLegalFigures } from './legal-figures.config';

/**
 * 🔴 MESSAGE 53 §2 ITEM 6 — THE DEMO OFFICE'S LICENCE DATES, AND THE THREE THINGS THAT MUST ALL
 * STILL HOLD AFTER THEY MOVED.
 *
 * `expireOfficeLicenceAwaitingDeclaration` puts office B past its printed expiry with a renewal
 * filed and proven and nothing declared — the state the presenter's whole demonstration runs on.
 * It used to shift the expiry to «thirty days ago», which on the 24 November walk was 25/10/2026,
 * and the licence screen showed two yellow warnings saying so.
 *
 * ⟶ AND THE WARNINGS WERE TRUE. Art. 10/b grants a licence for three calendar years ENDING ON 31
 *   DECEMBER, and `expiryMatchesThreeYearTerm` asks whether `expiresAt` equals
 *   `Date.UTC(issuedAt.year + 2, 11, 31)`. The term was created satisfying that and this seeder
 *   then moved one of the two dates on its own.
 *
 * The owner names all three facts that must survive the fix: «تاريخ بـ31 كانون الأول يضل يمثّل
 * ترخيص منتهي وطلب تجديد مقدّم بموعده … والإقرار بيشتغل.»
 *
 * ## 🔴 AND MEASURING «STILL EXPIRED» WITH `isBrokerLicenseCurrentlyLapsed` WOULD HAVE BEEN WRONG
 *
 * That predicate answers FALSE for this office, and correctly: past 31 December, an office whose
 * renewal was filed on time stays valid until the regulator decides — the owner's own
 * renewal-pending rule. So it is NOT what «منتهي» on the screen reflects.
 *
 * ⟶ What does is `deriveRenewalUnderStudy`, decision 128's derivation: past the printed expiry,
 *   filed on time, proof and reference attached, no deficiency notice, nobody declared ⟶
 *   `AWAITING_DECLARATION`. That is the state asserted here, and it is also the state the
 *   declaration lifts — so «الإقرار بيشتغل» is checked by driving the SAME function with a
 *   declaration row and watching the state move.
 *
 * ## WHY A UNIT SPEC OVER THE ARITHMETIC AND NOT AN e2e
 *
 * ⚠️ The dates the seeder computes depend on TODAY, so the only honest check recomputes them the
 * way the seeder does and asks the product's own predicates about the result. An e2e would pin a
 * single day and pass for a year.
 */

/** Exactly the expression `expireOfficeLicenceAwaitingDeclaration` uses for the new expiry. */
function targetExpiry(today: Date): Date {
  return new Date(Date.UTC(today.getUTCFullYear() - 1, 11, 31));
}

/** Exactly what the seeder derives for each term once its expiry has moved. */
function derivedIssuedAt(expiresAt: Date): Date {
  return new Date(Date.UTC(expiresAt.getUTCFullYear() - 2, 0, 1));
}

/** The seeder files 60 days before the shifted expiry. */
function filedAt(expiresAt: Date): Date {
  return new Date(expiresAt.getTime() - 60 * 24 * 60 * 60 * 1000);
}

/* Art. 11's own figure, as the seed records it. ⛔ Not a default: the function requires it
   precisely so the number cannot drift back into source (decision 123). */
const FIGURES: LicenceLegalFigures = {
  renewalApplicationDueDaysBeforeExpiry: 45,
  article14cSuspensionLimitYears: 2,
  capitalBands: [],
};

describe('the demo office licence dates (message 53 §2 item 6)', () => {
  /*
   * TODAY and four more days spread across a year: the seeder's answer is a function of the day
   * it runs on, so a single-day assertion would say nothing about the day of the rehearsal.
   */
  const DAYS = [
    new Date(),
    new Date(Date.UTC(2026, 0, 1)),
    new Date(Date.UTC(2026, 5, 15)),
    new Date(Date.UTC(2026, 11, 30)),
    new Date(Date.UTC(2026, 11, 31)),
  ];

  for (const today of DAYS) {
    const label = today.toISOString().slice(0, 10);
    const expiresAt = targetExpiry(today);
    const issuedAt = derivedIssuedAt(expiresAt);
    const renewalRequestedAt = filedAt(expiresAt);
    const term = {
      expiresAt,
      renewalRequestedAt,
      renewalProofDocumentId: 'doc-1',
      renewalReferenceNumber: 'CBJ-IN-DEMO-0417',
      renewalDeclaration: null,
    };

    it(`lands on a 31 December and raises no art. 10/b warning, run on ${label}`, () => {
      expect(expiresAt.getUTCMonth()).toBe(11);
      expect(expiresAt.getUTCDate()).toBe(31);
      // The screen's own predicate, not a re-derivation of it.
      expect(expiryMatchesThreeYearTerm({ issuedAt, expiresAt })).toBe(true);
      expect(expectedExpiryForThreeYearTerm(issuedAt)?.getTime()).toBe(
        expiresAt.getTime(),
      );
    });

    it(`is past its printed expiry with the filing in time, run on ${label}`, () => {
      expect(
        expiresAt.getTime(),
        'the shifted expiry is not in the past, so the office would read as inside its term ' +
          'and the declaration demonstration would have nothing to lift',
      ).toBeLessThan(today.getTime());
      const daysBeforeExpiry =
        (expiresAt.getTime() - renewalRequestedAt.getTime()) /
        (24 * 60 * 60 * 1000);
      expect(daysBeforeExpiry).toBeGreaterThanOrEqual(
        FIGURES.renewalApplicationDueDaysBeforeExpiry,
      );
      // And not filed in the future, which the route refuses.
      expect(renewalRequestedAt.getTime()).toBeLessThan(today.getTime());
    });

    it(`reaches AWAITING_DECLARATION, run on ${label}`, () => {
      expect(deriveRenewalUnderStudy(term, [], today, FIGURES)).toEqual({
        state: 'AWAITING_DECLARATION',
      });
    });

    it(`and the declaration lifts it, run on ${label}`, () => {
      const declared = deriveRenewalUnderStudy(
        {
          ...term,
          renewalDeclaration: {
            actorNameShown: 'منى الحوراني',
            declaredAt: today,
          },
        },
        [],
        today,
        FIGURES,
      );
      // NON-VACUITY: it must have MOVED, not merely be some state.
      expect(declared.state).not.toBe('AWAITING_DECLARATION');
      expect(declared.state).toBe('UNDER_STUDY');
    });

    it(`is NOT what \`isBrokerLicenseCurrentlyLapsed\` calls lapsed, run on ${label}`, () => {
      /*
       * Asserted explicitly because it is the trap: a timely filing keeps the office valid under
       * the renewal-pending rule, so the date-only predicate answers FALSE here. Anybody writing
       * «assert the licence still reads expired» against this function would get a green that
       * means the opposite of what they wanted.
       */
      expect(
        isBrokerLicenseCurrentlyLapsed(
          { expiresAt, renewalRequestedAt },
          today,
          FIGURES,
        ),
      ).toBe(false);
    });
  }

  /*
   * ⚠️ AND THE OLD BEHAVIOUR IS PINNED AS A NON-FINDING, so this file cannot pass over the
   * defect it was written for. «Thirty days ago» is almost never a 31 December, and on the day of
   * the walk it was not.
   */
  it('the shape it replaced really did break art. 10/b', () => {
    const walkDay = new Date(Date.UTC(2026, 10, 24));
    const thirtyDaysAgo = new Date(
      walkDay.getTime() - 30 * 24 * 60 * 60 * 1000,
    );
    // The term is created 1 January to 31 December two years on, and only the expiry moved.
    expect(
      expiryMatchesThreeYearTerm({
        issuedAt: new Date(Date.UTC(2026, 0, 1)),
        expiresAt: thirtyDaysAgo,
      }),
      'the pre-fix dates satisfy art. 10/b, so this spec is measuring nothing',
    ).toBe(false);
    expect(thirtyDaysAgo.toISOString().slice(0, 10)).toBe('2026-10-25');
  });
});
