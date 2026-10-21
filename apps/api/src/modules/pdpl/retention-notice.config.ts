/**
 * THE RETENTION NOTICE — what a category's elapsed clock says, and what it deliberately does not do.
 *
 * ## IT FILTERS. IT DESTROYS NOTHING.
 *
 * The notice is a READ. It has no write path to a disposal, to an anonymisation or to anything else,
 * and `retention-notice.inventory.spec.ts` asserts that as an ABSENCE — which is the only form that
 * can fail.
 *
 * ## TWO CHOICES, NOT THREE — AND ONE PLACE STILL SAYS THREE AND CANNOT BE CORRECTED
 *
 * EXTEND and NOMINATE-FOR-DESTRUCTION are built. ANONYMISATION IS HELD (register entry 89): none of
 * the four resolvable categories carries any identity, the identity sits on the SHARED `Customer`,
 * and the surface is six models including the UBO register — so anonymising one of a customer's
 * receipts is not an operation that exists. The owner has accepted the consequence: until the
 * identity surface is handled, the only route after a period elapses is destruction. The screen says
 * so in both languages (`rdNoticeTwoChoices`).
 *
 * `migrations/20261203100000_retention_extension_register/migration.sql` says "the same three
 * choices" in a comment. It is an APPLIED migration, so editing it would drift its stored checksum
 * and fail `db:checksums` — the one class of stale text in this repository that cannot be corrected
 * where it sits. This file is the authority; that comment is history.
 *
 * The choices are separate acts, each with its own permission, taken by a person who
 * has read the notice.
 *
 * ## IT EXPLAINS ITSELF, AND THAT IS NOT DECORATION
 *
 * From the owner's policy paper: *"an employee who clicks accept on an alert that does not explain
 * itself is an employee signing for the unknown."* So every notice carries, beside the count:
 *
 *   * WHICH ARTICLE set the floor for this category, with its instrument — the same article the
 *     refusal cites, read through `retention-floors.config.ts` rather than re-derived, because two
 *     paths to that answer is two chances for a screen to name a different statute from the one
 *     that refused a shorter period an hour earlier;
 *   * WHAT DATE THE COUNT RAN FROM, in words rather than as a column name — "the date the client
 *     payment was received, which closes that transaction" answers the question an officer is
 *     actually asking;
 *   * AND THAT NO LEGAL HOLD STANDS on them, stated rather than implied, because the absence of a
 *     hold is a fact the reader is relying on when they choose destruction.
 *
 * ## A CATEGORY IT CANNOT RESOLVE GETS A ROW THAT SAYS SO
 *
 * Decision 28's family. An office that sets a period for a category it named itself and is never
 * alerted will believe the system is watching it, and silence there is the defect — so an
 * unresolvable category appears with `resolvable: false` and its measured reason, and the screen
 * renders that loudly on the category's own row rather than omitting it.
 */

import {
  type StatutoryRetentionFloor,
  floorForCategory,
} from './retention-floors.config';
import {
  resolutionFor,
  unresolvableReason,
} from './retention-resolution.config';
import { inertReason, periodIsActionable } from './retention-template.config';

export interface RetentionNoticeView {
  recordCategory: string;
  /** NULL where the category ships floored and the office has not set a period — decisions 32 and
   *  33. The row still appears; nothing is counted against it. */
  retentionPeriodMonths: number | null;
  /**
   * CAN THE SYSTEM ACT ON THIS CATEGORY AT ALL?
   *
   * False when there is no period, or when no lawyer has confirmed the one there is. Distinct from
   * `resolvable`, and the two answer different questions — which is why both exist:
   *
   *   * `resolvable: false` means this category can NEVER produce a notice, because no date in this
   *     system marks the end of its purpose. Nothing the office does changes it.
   *   * `actionable: false` means it cannot produce one YET, and the office knows what to do about
   *     it: set the period, or get it confirmed.
   *
   * Collapsing them would tell an office that its KYC category can never be watched, when what is
   * actually true of a shipped floored row is that nobody has set the period.
   */
  actionable: boolean;
  /** Why it is not actionable, in words — null when it is. */
  inertReason: string | null;
  /** False means no notice is possible for this category, ever — and `reason` says why. */
  resolvable: boolean;
  /** Present only when `resolvable` is false. */
  unresolvableReason: string | null;
  /** How many records have passed their period and are neither held nor extended. */
  elapsedCount: number;
  /**
   * THE IDS, so an extension can NAME the records it covers.
   *
   * Added because the screen could not otherwise extend honestly: the register has to say WHICH
   * records were extended, and a screen holding only a count would have to send a placeholder — a
   * register row naming no record is a false entry in the one place that exists to be justifiable.
   *
   * Bounded at `ELAPSED_IDS_CAP`, and `elapsedCount` is the TRUE total either way, so a reader is
   * never shown a smaller number than the one that is really elapsed.
   */
  elapsedRecordIds: string[];
  /** How many were excluded because a legal hold stands — reported, not hidden. */
  heldCount: number;
  /** How many were excluded because an extension still covers them. */
  extendedCount: number;
  /** The statute that set the floor for this category, or null where none is decided. */
  floor: {
    instrument: string;
    article: string;
    operativeText: string;
  } | null;
  /** What the count ran from, in words. Null when the category is unresolvable. */
  countedFrom: string | null;
  /** Stated rather than implied — the reader relies on it when choosing destruction. */
  noLegalHoldStatement: string;
}

/**
 * The cap on ids returned per category. The extend DTO accepts at most 500 record ids, so sending
 * more than that would be a request the server refuses — the two figures are the same number for
 * that reason, and the count is unbounded so the cap never understates what is elapsed.
 */
export const ELAPSED_IDS_CAP = 500;

export interface RetentionNoticeInput {
  recordCategory: string;
  retentionPeriodMonths: number | null;
  /** REQUIRED, not optional, and that is the point: a caller who omitted it would make "nobody
   *  confirmed this" and "the caller did not look" the same thing, and the derivation would then
   *  alert on a draft period. The shipped template puts rows in exactly that state on purpose. */
  confirmedByLegalCounselAt: Date | null;
  elapsedCount: number;
  elapsedRecordIds: string[];
  heldCount: number;
  extendedCount: number;
}

function floorView(floor: StatutoryRetentionFloor | null) {
  if (!floor) return null;
  return {
    instrument: floor.instrument,
    article: floor.article,
    operativeText: floor.operativeText,
  };
}

export function deriveRetentionNotice(
  input: RetentionNoticeInput,
): RetentionNoticeView {
  const resolution = resolutionFor(input.recordCategory);
  const floor = floorForCategory(input.recordCategory);
  /*
   * INERT — no period, or a period no lawyer has confirmed.
   *
   * `periodIsActionable` is the SAME predicate `disposal-batch.service.ts` refuses on, imported
   * rather than restated, because "is this period real" having two answers is the defect this
   * module has now paid for at the licence layer as well.
   *
   * The row still comes back, and that is decision 28's family: a category an office can see on its
   * own screen and is never alerted about is one it will believe the system is watching. What the
   * row carries instead of a count is the REASON.
   */
  const actionable = periodIsActionable(input);
  const inert = inertReason(input);
  const suppressed = resolution === null || !actionable;

  return {
    recordCategory: input.recordCategory,
    retentionPeriodMonths: input.retentionPeriodMonths,
    actionable,
    inertReason: inert,
    resolvable: resolution !== null,
    unresolvableReason: unresolvableReason(input.recordCategory),
    elapsedCount: suppressed ? 0 : input.elapsedCount,
    elapsedRecordIds: suppressed
      ? []
      : input.elapsedRecordIds.slice(0, ELAPSED_IDS_CAP),
    heldCount: suppressed ? 0 : input.heldCount,
    extendedCount: suppressed ? 0 : input.extendedCount,
    floor: floorView(floor),
    countedFrom: resolution?.triggerDescription ?? null,
    /*
     * TWO DIFFERENT SENTENCES, because "no hold stands" and "some are held" are different facts and
     * a reader choosing destruction is relying on which one it is. The held COUNT is reported
     * alongside rather than quietly subtracted: records vanishing from a count with no explanation
     * is how an officer concludes the system lost them.
     */
    noLegalHoldStatement:
      resolution === null
        ? 'No records are counted for this category, so no legal hold has been checked.'
        : input.heldCount === 0
          ? 'No legal hold stands on any of these records.'
          : `${input.heldCount} record(s) in this category are under an active legal hold and are NOT in the count above — a hold refuses destruction and anonymisation even when a person picks them.`,
  };
}

/** The elapsed cut-off for a period, as a date. Pure, so the boundary is provable without a clock. */
export function elapsedBefore(now: Date, retentionPeriodMonths: number): Date {
  /* Takes a NON-NULL period deliberately: a caller holding a null one has nothing to measure and
   * must not reach here at all. `periodIsActionable` is the guard, and keeping this signature
   * narrow is what makes forgetting it a compile error rather than a NaN cutoff. */
  /*
   * Month arithmetic through `setUTCMonth`, not `now - months * 30 * DAY`. A 30-day month is wrong
   * by up to five days a year, and the SLA work already paid for that: `renewalApplicationDueBy`
   * records that month arithmetic across a leap-year February is off by a day in exactly the
   * direction that reports an on-time filing as late. Here the direction is worse — a short month
   * would make records eligible for destruction BEFORE their period had run.
   */
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - retentionPeriodMonths);
  return cutoff;
}
