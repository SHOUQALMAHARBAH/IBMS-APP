import {
  floorForCategory,
  type StatutoryRetentionFloor,
} from './retention-floors.config';

/**
 * MODULE 0-ب — WHAT THE RETENTION SCHEDULE SHIPS WITH. Decisions 32 and 33.
 *
 * The retention machine was built across batch 5: a statutory floor that refuses, an elapsed
 * notice, an extension, a blocked phase, a disposal nomination under dual control. All of it ran
 * against a schedule holding ONE row — a draft `AuditLogEntry` period nobody had confirmed.
 *
 * This is the template: the categories an office starts with.
 *
 * ## THE DECISION THAT SHAPES EVERYTHING HERE: A FLOORED CATEGORY SHIPS WITH NO PERIOD
 *
 * The owner's reason, and it is the whole of it: **a period shipped beside an article number reads
 * as a legal opinion from us, and we do not have one.** So a category governed by one of the two
 * statutory floors ships with `retentionPeriodMonths` NULL and the screen shows the ARTICLE and the
 * FLOOR beside the empty field. The office fills it in above the floor, on its own lawyer's advice.
 *
 * A category with NO floor ships with a DEFAULT, because there a number is a convenience and
 * carries no legal claim — nothing is being asserted about what any statute requires.
 *
 * That asymmetry is not a compromise between two habits. It is one rule: **we supply a number
 * exactly where supplying one claims nothing.**
 *
 * ## AND AN EMPTY OR UNCONFIRMED PERIOD IS INERT — NO PROPOSAL, NO ALERT
 *
 * `confirmedByLegalCounselAt` already carries that, and the brief is explicit that no parallel flag
 * may be added. `disposal-batch.service.ts` has refused an unconfirmed period since group 5; the
 * NOTICE did not, which meant a shipped template would have started alerting an office about
 * records measured against a period nobody had set or signed. Both now read
 * `periodIsActionable()` — one predicate, so the two surfaces cannot disagree.
 *
 * ## WHAT THIS FILE MAY NOT DO
 *
 * **It adds no floor.** The fourteen unsourced category names from group 5 are a question for the
 * owner's lawyer, and a floor added on an engineer's reading is this product telling a broker the
 * law says something it does not. Every floored row below takes its floor by LOOKUP from
 * `retention-floors.config.ts` — `floorForCategory` — so this file cannot introduce one even by
 * accident, and `retention-template.config.spec.ts` asserts the two floor lists have not grown.
 *
 * **It is not a lock.** Decision 80: the office grants, edits and revokes freely. Pinning the
 * shipped set in a test constrains OUR template so a change to it is deliberate; it constrains no
 * office, and nothing anywhere refuses a category this file does not name.
 */

/** A category the product ships, and what it ships WITH. */
export interface RetentionTemplateCategory {
  /** The category name, which is also what `floorForCategory` is asked about. */
  recordCategory: string;
  /**
   * The period in months, or NULL where a statutory floor governs the category.
   *
   * NULL is not "unknown". It is the decision: shipping a number next to an article would be us
   * stating a legal opinion. `floorMonths` is displayed instead, and the office sets its own above
   * it.
   */
  defaultPeriodMonths: number | null;
  /**
   * What the period is counted FROM, in words, and it is not decoration — a period without its
   * trigger is a number somebody counts from the wrong day. For a floored category this restates
   * the statute's own trigger; for an unfloored one it is the office's own purpose ending.
   */
  countedFrom: string;
  /**
   * Why this category ships at all — one line a reader can argue with. Written into `legalBasis`
   * for an unfloored category; a floored one takes the floor's own citation instead.
   */
  note: string;
}

/** One month, named rather than written as 1 so the quote row reads as a decision. */
const ONE_MONTH = 1;

/**
 * THE SHIPPED SET.
 *
 * Deliberately short. Every row is either (a) a category one of the two DECIDED floors already
 * governs by name — so it ships with no period and the floor on screen — or (b) a category with no
 * floor at all and a default the owner has chosen. There is no third kind, and a category whose
 * floor nobody has sourced does not appear: that is the fourteen-unsourced-names question, and
 * guessing it here is the one thing this file must not do.
 */
export const RETENTION_TEMPLATE: readonly RetentionTemplateCategory[] = [
  // ───────────────────────────────── FLOORED: no period, the article shown instead
  {
    // The due-diligence record itself. Art. 17/أ's first limb.
    recordCategory: 'KYCRecord',
    defaultPeriodMonths: null,
    countedFrom:
      'completing the transaction OR ending the customer relationship, whichever is longer — the article’s own trigger',
    note: 'The statutory floor governs this category, so no period is shipped: the office sets one above the floor on its own legal advice.',
  },
  {
    // The customer's file — art. 17/أ's second limb, named in the floor's own category list.
    recordCategory: 'CustomerFile',
    defaultPeriodMonths: null,
    countedFrom:
      'ending the customer relationship OR the transaction, whichever is longer',
    note: 'The statutory floor governs this category, so no period is shipped.',
  },
  {
    // The four categories whose clock this system can actually compute all sit under the commercial
    // floor, and each is in that floor's declared list by name.
    recordCategory: 'Receipt',
    defaultPeriodMonths: null,
    countedFrom:
      'the closing of the financial transaction — the date the client payment was received',
    note: 'The commercial floor governs this category, so no period is shipped.',
  },
  {
    recordCategory: 'Remittance',
    defaultPeriodMonths: null,
    countedFrom:
      'the closing of the financial transaction — the date the premium was remitted to the insurer',
    note: 'The commercial floor governs this category, so no period is shipped.',
  },
  {
    recordCategory: 'CommissionLedgerEntry',
    defaultPeriodMonths: null,
    countedFrom:
      'the closing of the financial transaction — the date the commission was paid',
    note: 'The commercial floor governs this category, so no period is shipped.',
  },
  {
    recordCategory: 'Settlement',
    defaultPeriodMonths: null,
    countedFrom:
      'the closing of the financial transaction — the date the client settlement payment was confirmed',
    note: 'The commercial floor governs this category, so no period is shipped.',
  },
  {
    recordCategory: 'Invoice',
    defaultPeriodMonths: null,
    countedFrom:
      'the closing of the financial transaction, which for an invoice is its receipt — a due date is not a closing',
    note: 'The commercial floor governs this category, so no period is shipped. Its clock is not computable here: group 7b measured that an invoice is closed by its Receipt, so the Receipt category is what the notice counts.',
  },

  // ───────────────────────────────── UNFLOORED: a default, because a number claims nothing here
  {
    /*
     * THE FIRST DEFAULT, and the owner's own category: a quote requested and never bought.
     *
     * ONE MONTH, and the office may set it shorter or longer — its own rules, nothing statutory.
     *
     * COUNTED FROM THE END OF THE PURPOSE, NOT FROM ARRIVAL. Her reason is the whole design: a
     * month counted from arrival deletes a quote the customer is still considering. The purpose
     * ends when the client refuses, or when the quote expires.
     *
     * MEASURED, and only ONE of those two limbs is representable:
     *
     *   * THE REFUSAL IS. `ClientDecision` carries `decision` and `decidedAt`, one per Opportunity,
     *     and `REJECT` is the refusal. A quote reaches it in two hops —
     *     `Quotation.rfq.opportunity.clientDecision` — and `retention-resolution.config.ts` counts
     *     it from there, so a quote on an opportunity the client ACCEPTED is never swept and
     *     neither is one still live.
     *   * THE EXPIRY IS NOT. `Quotation` has no `validUntil`, no expiry and no status of any kind —
     *     measured against the model, 25 fields and not one of them a validity date. So "the expiry
     *     of the quote" cannot be computed, and this file says so rather than approximating it from
     *     `receivedAt` plus a guessed validity, which would be the arrival clock the owner
     *     specifically refused wearing a different name.
     *
     * The consequence, stated: a quote the client never answered at all has no trigger and is never
     * elapsed. That is the safe direction and it is the honest one — this product does not know
     * when such a quote stopped being useful.
     */
    recordCategory: 'Quotation',
    defaultPeriodMonths: ONE_MONTH,
    countedFrom:
      'the END OF THE PURPOSE — the date the client refused. The quote’s own expiry is the other limb of this trigger and is NOT recorded anywhere: `Quotation` carries no validity date, so a quote the client never answered has no trigger and is never counted.',
    note: 'No statutory floor is decided for this category, so the office’s own period governs and this one month is a default rather than a minimum. Counted from the refusal, never from arrival: a month from arrival would delete a quote the customer is still considering.',
  },
];

/**
 * The floor governing a template row, or null.
 *
 * A LOOKUP, never a field on the row above — which is what makes "this file adds no floor"
 * structural rather than a promise. If `retention-floors.config.ts` stops governing a name, the
 * template row changes shape with it and the spec notices.
 */
export function templateFloor(
  category: RetentionTemplateCategory,
): StatutoryRetentionFloor | null {
  return floorForCategory(category.recordCategory);
}

/**
 * IS THIS SCHEDULE ROW SOMETHING THE SYSTEM MAY ACT ON?
 *
 * ONE predicate, read by the notice AND by the disposal nomination, because the two must not
 * disagree about what a draft is. Two conditions, and each is a separate failure:
 *
 *   * NO PERIOD. Nothing to measure. A shipped floored category is in this state ON PURPOSE, and an
 *     alert against it would be counting against a period nobody has set.
 *   * NOT CONFIRMED BY LEGAL COUNSEL. A period somebody typed is a draft until a lawyer signs it
 *     off, and destroying records against a draft is the one mistake in this workflow that cannot
 *     be undone. `disposal-batch.service.ts` already said exactly this; the notice did not.
 *
 * NOT a new flag — the brief forbids one, and rightly: a second column answering "is this period
 * real" is a second answer to it.
 *
 * ## IT IS A TYPE PREDICATE, AND THAT IS WHAT MAKES THE ORDERING STRUCTURAL
 *
 * Returning `item is T & { retentionPeriodMonths: number }` narrows the period for everything after
 * the guard, so `elapsedBefore` — which takes a non-null period deliberately — can only be reached
 * through it. A plain `boolean` would have left the call site needing a cast, and a cast is where
 * the guard becomes optional: somebody reorders two lines, the cast still compiles, and the cutoff
 * is silently NaN. Prefer the form that cannot express the mistake.
 */
export function periodIsActionable<
  T extends {
    retentionPeriodMonths: number | null;
    confirmedByLegalCounselAt: Date | null;
  },
>(item: T): item is T & { retentionPeriodMonths: number } {
  return (
    item.retentionPeriodMonths !== null &&
    item.confirmedByLegalCounselAt !== null
  );
}

/** Why this row is inert, for a reader — or null when it is actionable. */
export function inertReason(item: {
  recordCategory: string;
  retentionPeriodMonths: number | null;
  confirmedByLegalCounselAt: Date | null;
}): string | null {
  if (item.retentionPeriodMonths === null) {
    const floor = floorForCategory(item.recordCategory);
    return floor === null
      ? 'No retention period is set for this category, so nothing is measured against it and no records are proposed for disposal.'
      : `No retention period is set for this category. A statutory floor applies — ${floor.instrument}, ${floor.article}: ${floor.operativeText} — so the office sets its own period at or above ${floor.floorMonths} months on its own legal advice. Until then nothing is measured and no records are proposed.`;
  }
  if (item.confirmedByLegalCounselAt === null) {
    return 'This retention period has not been confirmed by legal counsel. It is a draft until then, so nothing is measured against it and no records are proposed for disposal.';
  }
  return null;
}
