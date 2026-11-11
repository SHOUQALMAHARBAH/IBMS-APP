import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SECOND_NOTICE_DAYS_BEFORE_EXPIRY,
  deriveRenewalNotice,
  firstNoticeDaysBeforeExpiry,
} from './license-renewal-notice.config';
import type { LicenseTermRow } from './license-standing.config';
import { INSTRUMENT_LICENCE_FIGURES } from './legal-figures.double';

/** A term expiring 31 December 2026, art. 10/b's shape. */
function term(over: Partial<LicenseTermRow> = {}): LicenseTermRow {
  return {
    issuedAt: new Date('2024-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    renewalRequestedAt: null,
    ...over,
  };
}

/** `n` whole days before the term above expires. */
function daysBefore(n: number): Date {
  return new Date(Date.UTC(2026, 11, 31 - n));
}

describe("art. 11's figure has ONE home", () => {
  it('declares the threshold as the imported constant, not as a numeric literal', () => {
    /*
     * Measured 2026-11-10: art. 11's 45 had two literal homes, and the second sat under a comment
     * claiming it was "reused through `renewalApplicationDueBy` rather than restated here". So a
     * reader checking whether the number was duplicated was told it was not.
     *
     * ## WHY THIS READS THE SOURCE TEXT, WHICH LOOKS LIKE OVERKILL AND IS NOT
     *
     * The first version of this test compared the two CONSTANTS — and the plant survived it. Putting
     * the literal `45` back passed, because `45 === 45`: a value comparison cannot detect a
     * duplicated figure while the duplicate is still CORRECT, which is exactly the moment somebody
     * introduces one. It only starts failing after the drift has already shipped, which is the
     * failure it exists to prevent.
     *
     * "This number has one home" is a property of the TEXT, so the assertion is on the text. Rule 12
     * applies to the read itself: the declaration must be FOUND, or an absent match would pass.
     */
    const source = readFileSync(
      join(__dirname, 'license-renewal-notice.config.ts'),
      'utf8',
    );
    /*
     * ## RE-POINTED 2026-11-11, NOT DELETED — OWNER DECISION 123, which is what this guard's own
     * message demanded if the declaration ever moved.
     *
     * Art. 11's figure has no home in source AT ALL now: it is a `LegalValue` row. So the property
     * worth pinning is no longer *the constant is imported rather than restated* — there is no
     * constant to import. It is the stronger version of the same thing: **the first notice's
     * threshold is read off the figures object and is never a number in this file.**
     *
     * REFLOW-TOLERANT for the recorded reason: prettier owns the line breaks here and wrapped the
     * previous declaration onto two lines minutes after the first version of this test was
     * written, which anchored `(.+);$` on one line and went red on a CORRECT tree.
     */
    const body =
      /export function firstNoticeDaysBeforeExpiry\([\s\S]*?\)[\s\S]*?\{([\s\S]+?)\n\}/.exec(
        source,
      );
    expect(
      body,
      'the firstNoticeDaysBeforeExpiry declaration was not found — this guard is now BLIND. Re-point it; do not delete it.',
    ).not.toBeNull();
    expect(
      body![1].trim().replace(/\s+/g, ' '),
      "art. 11's figure must come from the legal-values row through `figures`, never be restated as a number here",
    ).toBe('return figures.renewalApplicationDueDaysBeforeExpiry;');
  });

  it('is the figure the filing deadline itself uses, so the notice cannot drift from the due date', () => {
    // Non-vacuity, rule 12: two values that were both somehow undefined would also be equal.
    expect(
      firstNoticeDaysBeforeExpiry(INSTRUMENT_LICENCE_FIGURES),
    ).toBeGreaterThan(0);
    expect(firstNoticeDaysBeforeExpiry(INSTRUMENT_LICENCE_FIGURES)).toBe(
      INSTRUMENT_LICENCE_FIGURES.renewalApplicationDueDaysBeforeExpiry,
    );
    expect(
      deriveRenewalNotice(
        term(),
        daysBefore(
          INSTRUMENT_LICENCE_FIGURES.renewalApplicationDueDaysBeforeExpiry,
        ),
        INSTRUMENT_LICENCE_FIGURES,
      ).stage,
    ).toBe('FIRST');
  });
});

describe('the renewal notice series', () => {
  it('says nothing while the expiry is far off', () => {
    expect(
      deriveRenewalNotice(term(), daysBefore(90), INSTRUMENT_LICENCE_FIGURES)
        .stage,
    ).toBe('NONE');
  });

  it('starts on art. 11 day — 46 out is silent, 45 is the FIRST notice', () => {
    // The boundary is asserted on BOTH sides. A `<` where `<=` belongs starts the series a day
    // late, which on this particular figure means the office is first told about its renewal
    // application on the day AFTER the application was due.
    expect(
      deriveRenewalNotice(term(), daysBefore(46), INSTRUMENT_LICENCE_FIGURES)
        .stage,
    ).toBe('NONE');
    expect(
      deriveRenewalNotice(
        term(),
        daysBefore(firstNoticeDaysBeforeExpiry(INSTRUMENT_LICENCE_FIGURES)),
        INSTRUMENT_LICENCE_FIGURES,
      ).stage,
    ).toBe('FIRST');
  });

  it('becomes the SECOND notice exactly at 30, and 31 is still the first', () => {
    expect(
      deriveRenewalNotice(term(), daysBefore(31), INSTRUMENT_LICENCE_FIGURES)
        .stage,
    ).toBe('FIRST');
    expect(
      deriveRenewalNotice(
        term(),
        daysBefore(SECOND_NOTICE_DAYS_BEFORE_EXPIRY),
        INSTRUMENT_LICENCE_FIGURES,
      ).stage,
    ).toBe('SECOND');
  });

  it('then CONTINUES, every day, right up to the expiry', () => {
    // «مستمر». 29 and 1 are both asserted because a series that fired at 30 and then stopped would
    // pass a test that only looked at one of them.
    expect(
      deriveRenewalNotice(term(), daysBefore(29), INSTRUMENT_LICENCE_FIGURES)
        .stage,
    ).toBe('CONTINUING');
    expect(
      deriveRenewalNotice(term(), daysBefore(1), INSTRUMENT_LICENCE_FIGURES)
        .stage,
    ).toBe('CONTINUING');
  });

  it('a term expiring TODAY is still running, not expired', () => {
    // Art. 10/b's term ends ON 31 December. `< 0` rather than `<= 0` is the whole point: the other
    // reading announces an expiry while the office may still lawfully trade, and the gate agrees
    // with this boundary.
    const onTheDay = deriveRenewalNotice(
      term(),
      daysBefore(0),
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(onTheDay.stage).toBe('CONTINUING');
    expect(onTheDay.daysToExpiry).toBe(0);
  });

  it('once the date passes it reports EXPIRED and says how long ago', () => {
    const after = deriveRenewalNotice(
      term(),
      daysBefore(-5),
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(after.stage).toBe('EXPIRED');
    expect(after.daysToExpiry).toBe(-5);
  });

  it('A RECORDED FILING DOES NOT QUIETEN IT — the filing is reported beside the stage', () => {
    // The brief is explicit and the direction of the error is the reason: a filing is not a
    // decision. An office that applied on time and has heard nothing is the office that most needs
    // to keep being told, because what lifts the block is the NEW TERM being recorded with its
    // certificate — which has not happened.
    const filed = deriveRenewalNotice(
      term({ renewalRequestedAt: new Date('2026-11-10T00:00:00.000Z') }),
      daysBefore(20),
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(filed.stage).toBe('CONTINUING');
    expect(filed.renewalFiled).toBe(true);
    // And an unfiled term at the same moment reads the same stage — so the stage is genuinely
    // independent of the filing rather than coincidentally equal.
    expect(
      deriveRenewalNotice(term(), daysBefore(20), INSTRUMENT_LICENCE_FIGURES)
        .stage,
    ).toBe('CONTINUING');
  });

  it('is silent with no term at all, rather than counting down to a date nobody recorded', () => {
    const none = deriveRenewalNotice(
      null,
      daysBefore(10),
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(none.stage).toBe('NONE');
    expect(none.daysToExpiry).toBeNull();
    expect(none.expiresAt).toBeNull();
    // NO_TERM_ON_RECORD is a block, which the licence panel states. A countdown here would invent
    // an expiry.
    expect(none.renewalFiled).toBe(false);
  });

  it('carries art. 11s own deadline, derived rather than restated', () => {
    const n = deriveRenewalNotice(
      term(),
      daysBefore(60),
      INSTRUMENT_LICENCE_FIGURES,
    );
    // 45 calendar days before 2026-12-31 is 2026-11-16. Taken from `renewalApplicationDueBy`, the
    // one home for that arithmetic, so a change to the figure cannot leave the notice behind.
    expect(n.applicationDueBy).toBe('2026-11-16T00:00:00.000Z');
  });

  it('measures in whole UTC DAYS, so the answer does not depend on the hour it is read', () => {
    // Dividing a millisecond difference would make the 45-day boundary move with the time of day:
    // an office reading at 09:00 and at 17:00 would be told different things about one date.
    const morning = deriveRenewalNotice(
      term(),
      new Date('2026-11-16T06:00:00.000Z'),
      INSTRUMENT_LICENCE_FIGURES,
    );
    const evening = deriveRenewalNotice(
      term(),
      new Date('2026-11-16T22:30:00.000Z'),
      INSTRUMENT_LICENCE_FIGURES,
    );
    expect(morning.stage).toBe('FIRST');
    expect(evening.stage).toBe('FIRST');
    expect(morning.daysToExpiry).toBe(evening.daysToExpiry);
  });

  it('crosses a leap-year February without losing a day', () => {
    // 2028 is a leap year, and the 45-day span from 2028-01-15 to 2028-02-29 includes 29 February.
    // Month arithmetic would be wrong by one here, in the direction that reports the application as
    // due a day later than it is.
    const leap = term({ expiresAt: new Date('2028-02-29T00:00:00.000Z') });
    expect(
      deriveRenewalNotice(
        leap,
        new Date('2028-01-15T00:00:00.000Z'),
        INSTRUMENT_LICENCE_FIGURES,
      ).stage,
    ).toBe('FIRST');
    expect(
      deriveRenewalNotice(
        leap,
        new Date('2028-01-14T00:00:00.000Z'),
        INSTRUMENT_LICENCE_FIGURES,
      ).stage,
    ).toBe('NONE');
  });
});
