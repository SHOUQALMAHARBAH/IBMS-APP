import { renewalApplicationDueBy } from './broker-license.config';
import type { LicenseTermRow } from './license-standing.config';

/**
 * MODULE 0-ب, THE LICENCE, PIECE 3 — THE RENEWAL NOTICE SERIES.
 *
 * The office is told its licence is running out, starting 45 days before expiry, again at 30, and
 * then CONTINUING until the date passes.
 *
 * ## IT IS DERIVED, AND THAT IS NOT A STYLE CHOICE
 *
 * Nothing is stored: no notice row, no "last sent at" column, no scheduled job. The series is a
 * function of the term's own `expiresAt` and the clock.
 *
 * Decision 71's habit, which this batch spent its first half restoring: the licence STATUS was
 * stored once and became the third of three answers to whether the office may practise. A stored
 * notice state would be the same defect one layer over — a column saying "notified" that can
 * disagree with whether the licence is in fact 45 days from running out, and the column is the one
 * that goes stale. A derived series cannot be wrong about the date it is derived from.
 *
 * It also makes the CONTINUING half free. A sent-notice table has to decide how often to re-send and
 * then remember; a derivation is simply true every time it is read, which is what «مستمر» means.
 *
 * ## THE TWO THRESHOLDS, AND WHY 45 IS NOT INVENTED HERE
 *
 * 45 is art. 11's own figure — the renewal application is due 45 calendar days before expiry, and
 * `renewalApplicationDueBy` is that arithmetic, REUSED rather than restated. So the first notice
 * lands on the day the obligation itself starts, not on a number somebody liked.
 *
 * 30 is the owner's second threshold and carries no article. It is declared as such below rather
 * than dressed up with a citation — this product has invented a legal figure once and the rule out
 * of it was: a number with no source says so.
 *
 * ## A RECORDED FILING DATE DOES NOT LIFT THE BLOCK, AND MUST NOT QUIETEN THE NOTICE EITHER
 *
 * `renewalRequestedAt` means the office filed its application. It does NOT mean the CBJ decided.
 * The brief is explicit, and the reason is the direction of the error: an office that filed on time
 * and heard nothing is exactly the office that most needs to keep being told the date is coming,
 * because what lifts the block is the NEW TERM being recorded with its certificate — which has not
 * happened yet.
 *
 * So the notice reports the filing as a FACT ALONGSIDE it (`renewalFiled`), and the screen says so,
 * rather than the filing suppressing the series. The one thing a filing changes is the wording: an
 * office that has filed is waiting, an office that has not is late or about to be.
 *
 * ## WHO SEES IT — A PERMISSION HOLDER, NEVER A ROLE NAME (و.١١)
 *
 * There is no routing table and no owner column. The notice rides the licence read, which is gated
 * on `license.manage`, and is rendered on the regulatory-obligations screen — the calendar's own
 * home. MEASURED rather than assumed: `license.manage` and `compliance-calendar.manage` are held by
 * the SAME seeded set (COMPLIANCE_OFFICER), so the notice reaches exactly the people who work the
 * calendar, and no new permission code is needed for it.
 *
 * An office that renames or splits that role keeps the notice, because the code is what carries it.
 */

/** Art. 11's own figure, reused through `renewalApplicationDueBy` rather than restated here. */
export const FIRST_NOTICE_DAYS_BEFORE_EXPIRY = 45;

/**
 * The owner's second threshold. NO ARTICLE — stated plainly, because a figure displayed beside a
 * citation it does not have is this product telling a broker the law says something it does not.
 */
export const SECOND_NOTICE_DAYS_BEFORE_EXPIRY = 30;

export type RenewalNoticeStage =
  /** More than 45 days out, or there is nothing to notice about. */
  | 'NONE'
  /** Art. 11's deadline has arrived: the renewal application is due now. */
  | 'FIRST'
  /** 30 days out — the owner's second threshold. */
  | 'SECOND'
  /** Inside 30 days and still running: said every time the screen is read, until the date passes. */
  | 'CONTINUING'
  /** The date passed. The notice stops being a warning and the block is the fact. */
  | 'EXPIRED';

export interface RenewalNotice {
  stage: RenewalNoticeStage;
  /** Whole days from `now` to the expiry. Negative once it has passed, so a reader can say how long
   *  ago rather than only that it happened. */
  daysToExpiry: number | null;
  expiresAt: string | null;
  /** Art. 11's deadline for the application itself. */
  applicationDueBy: string | null;
  /**
   * Whether an application is on record. Reported BESIDE the stage, never instead of it: a filing
   * is not a decision, and the block lifts on the new term being recorded.
   */
  renewalFiled: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days between two instants, by UTC DATE rather than by dividing the millisecond difference.
 *
 * Dividing would make "45 days" depend on the time of day the screen happened to be opened — an
 * office reading at 09:00 and at 17:00 would be told different things about the same date, and the
 * boundary this is measured against is art. 11's deadline.
 */
function wholeDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * The notice for this office today.
 *
 * `term` is the CURRENT one — `pickCurrentTerm`'s answer, the latest expiry, which is the same term
 * the gate decides on. Passing the term covering today would warn about a licence that has already
 * been renewed.
 */
export function deriveRenewalNotice(
  term: LicenseTermRow | null,
  now: Date,
): RenewalNotice {
  if (term === null) {
    // NO TERM ON RECORD is a block, not a warning about a date — there is no date. The licence
    // panel already says so, and inventing a notice here would give a reader a countdown to an
    // expiry nobody recorded.
    return {
      stage: 'NONE',
      daysToExpiry: null,
      expiresAt: null,
      applicationDueBy: null,
      renewalFiled: false,
    };
  }

  const daysToExpiry = wholeDaysBetween(now, term.expiresAt);
  const renewalFiled = term.renewalRequestedAt !== null;
  const base = {
    daysToExpiry,
    expiresAt: term.expiresAt.toISOString(),
    applicationDueBy: renewalApplicationDueBy(term.expiresAt).toISOString(),
    renewalFiled,
  };

  // Ordered from the far end in, so each boundary is tested on the side it decides. `<= 0` first
  // because a term expiring TODAY has not run out — art. 10/b's term ends ON 31 December — and
  // `< 0` would announce an expiry a day early while the office may still trade.
  if (daysToExpiry < 0) return { ...base, stage: 'EXPIRED' };
  if (daysToExpiry <= SECOND_NOTICE_DAYS_BEFORE_EXPIRY) {
    // INCLUSIVE at 30, and then CONTINUING below it — the brief's «مستمر». The distinction between
    // SECOND and CONTINUING is what the office is being told: that the second threshold has arrived,
    // versus that it is still running out. Collapsing them would make the day-30 notice
    // indistinguishable from the twenty-nine after it, which is how a notice becomes wallpaper.
    return {
      ...base,
      stage:
        daysToExpiry === SECOND_NOTICE_DAYS_BEFORE_EXPIRY
          ? 'SECOND'
          : 'CONTINUING',
    };
  }
  if (daysToExpiry <= FIRST_NOTICE_DAYS_BEFORE_EXPIRY) {
    return { ...base, stage: 'FIRST' };
  }
  return { ...base, stage: 'NONE' };
}
