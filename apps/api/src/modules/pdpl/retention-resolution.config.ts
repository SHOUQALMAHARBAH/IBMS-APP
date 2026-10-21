/**
 * WHICH RECORD CATEGORIES THIS SYSTEM CAN ACTUALLY RESOLVE — the one new structural piece the
 * retention notice needs, and the honest list of what it cannot.
 *
 * ## WHY A RESOLUTION IS NEEDED AT ALL
 *
 * MEASURED: `recordCategory` on `RetentionScheduleItem` is free text and is resolved to a model by
 * NOTHING — the only exact-string reader anywhere is `audit.service.ts:165` looking for the literal
 * `'AuditLogEntry'`. So for a notice to say "142 files" the system needs a declared answer to two
 * questions per category: WHICH RECORDS, and FROM WHAT DATE does the count run.
 *
 * ## WHY IT IS A DECLARED LIST IN CODE AND NOT A SEEDED TABLE
 *
 * A resolution carries a QUERY, not data: "count `Receipt` rows whose `receivedAt` plus the period
 * has passed". A seeded row cannot hold that, and a column naming a model plus a column naming a
 * date field would be a string-typed instruction nothing checks — the shape this file exists to
 * avoid. So it is declared here, in the same shape as `STATUTORY_RETENTION_FLOORS` beside it, and
 * `retention-resolution.config.spec.ts` pins the set so a fifth cannot arrive without a decision.
 *
 * ## THE LIST IS SHORT, AND THE ABSENCES ARE THE FINDING
 *
 * Only four categories are resolvable, all under the TEN-YEAR commercial floor. Every absence below
 * is measured, and the brief's rule is why each one is an absence rather than an approximation:
 * *"If a category's trigger cannot be computed from data that exists, that category is NOT in the
 * table and says so. Do not approximate a trigger."*
 *
 * **THE FIVE-YEAR AML FLOOR HAS NO RESOLVABLE CATEGORY AT ALL — the headline one.** Art. 17/أ's
 * trigger is "completing the transaction OR ending the relationship, WHICHEVER IS LONGER", and the
 * second half has no date anywhere: `Customer` carries exactly three `DateTime` columns
 * (`dateOfBirth`, `createdAt`, `updatedAt`), nine other models have a `closedAt` and `Customer` is
 * not among them, and `CustomerStatus.CLOSED` is a STATE that nothing stamps a date for. So
 * `KYCRecord` and `Customer` are not here, and the screen says so on their own rows.
 *
 * **AND THREE OF THE COMMERCIAL FLOOR'S OWN CATEGORY NAMES NAME NO MODEL**: `Payment`,
 * `Collection` and `BankReconciliation` do not exist in `schema.prisma`. They are still legitimate
 * things for an office to type — the floor matches a typed string, not a model — so they keep their
 * floor and can never produce a notice.
 *
 * **`Invoice` IS EXCLUDED DELIBERATELY.** It carries only `dueDate` and `createdAt`. A due date is
 * not a closing: an unpaid invoice's transaction has not closed, so counting from it would start the
 * clock on a transaction still running. Its closing is its `Receipt`, which is a different model and
 * is resolvable in its own right.
 */

import { floorForCategory, normaliseCategory } from './retention-floors.config';

/** How a category's records are found and when their clock starts. */
export interface CategoryResolution {
  /** The category name as an office would type it — matched through `normaliseCategory`. */
  recordCategory: string;
  /** The Prisma model property the count runs against. */
  modelProperty:
    'receipt' | 'remittance' | 'commissionLedgerEntry' | 'settlement';
  /** The column the retention period is counted FROM. */
  triggerColumn: string;
  /**
   * Whether that column is NULLABLE — declared, because a `where` that NEGATES an elapsed test has
   * to know.
   *
   * `NOT (trigger <= cutoff)` is NULL for a NULL trigger, and a WHERE clause keeps only TRUE, so
   * every row whose clock never started would be dropped from the read — an unpaid commission entry
   * vanishing from what the office is owed. `notBlockedWhere` adds `trigger IS NOT NULL` to the
   * conjunction when this is true, which makes the conjunction FALSE rather than NULL. Prisma's
   * non-nullable `DateTimeFilter` refuses `not: null`, so the flag cannot be inferred at the call
   * site and is declared here instead, beside the column it is about.
   */
  triggerIsNullable: boolean;
  /**
   * What that column MEANS, in the words the notice shows a reader. The notice carries this rather
   * than the column name, because "what date did the count run from" is the question an officer is
   * actually asking and a column name does not answer it.
   */
  triggerDescription: string;
}

export const CATEGORY_RESOLUTIONS: readonly CategoryResolution[] = [
  {
    recordCategory: 'Receipt',
    modelProperty: 'receipt',
    triggerColumn: 'receivedAt',
    triggerIsNullable: false,
    triggerDescription:
      'the date the client payment was received, which closes that transaction',
  },
  {
    recordCategory: 'Remittance',
    modelProperty: 'remittance',
    triggerColumn: 'remittedAt',
    triggerIsNullable: true,
    triggerDescription:
      'the date the premium was remitted to the insurer, which closes that transaction',
  },
  {
    recordCategory: 'CommissionLedgerEntry',
    modelProperty: 'commissionLedgerEntry',
    triggerColumn: 'paidAt',
    triggerIsNullable: true,
    triggerDescription:
      'the date the commission was paid, which closes that transaction',
  },
  {
    recordCategory: 'Settlement',
    modelProperty: 'settlement',
    triggerColumn: 'clientPaymentConfirmedAt',
    triggerIsNullable: true,
    triggerDescription:
      'the date the client settlement payment was confirmed, which closes that transaction',
  },
] as const;

/**
 * THE CATEGORIES THIS SYSTEM CANNOT RESOLVE, each with the measured reason — because a category an
 * office named itself and is never alerted about is one it will believe the system is watching.
 * Decision 28's family: silence there is the defect, so the screen reads this and says it.
 */
export const UNRESOLVABLE_REASONS: Readonly<Record<string, string>> = {
  KYCRecord:
    'Art. 17/أ counts from completing the transaction OR ending the relationship, whichever is longer — and this system records no date for a relationship ending. `Customer` carries only dateOfBirth, createdAt and updatedAt, and CustomerStatus.CLOSED is a state nothing stamps a date for. The trigger cannot be computed, and approximating it would start a five-year clock from the wrong day.',
  Customer:
    'Same as KYCRecord: there is no date for a customer relationship ending, so the longer-of-two trigger cannot be computed.',
  Invoice:
    'An invoice carries only a dueDate and a createdAt. A due date is not a closing — an unpaid invoice has not closed — so counting from it would start the clock on a transaction still running. Its closing is its Receipt, which IS resolved.',
  Payment:
    'No Payment model exists in this system. The category name is still valid for a period and a floor; it can never produce a notice.',
  Collection:
    'No Collection model exists in this system. The category name is still valid for a period and a floor; it can never produce a notice.',
  BankReconciliation:
    'No BankReconciliation model exists in this system. The category name is still valid for a period and a floor; it can never produce a notice.',
};

/** The resolution for a category, or `null` — matched case- and separator-insensitively. */
export function resolutionFor(
  recordCategory: string,
): CategoryResolution | null {
  const needle = normaliseCategory(recordCategory);
  if (!needle) return null;
  return (
    CATEGORY_RESOLUTIONS.find(
      (r) => normaliseCategory(r.recordCategory) === needle,
    ) ?? null
  );
}

/**
 * Why a category produces no notice, for the screen to say out loud.
 *
 * Returns a measured reason where one is recorded, and a GENERIC one otherwise — because an office
 * may name any category it likes, and "we have not been told what records this means" is the honest
 * answer for a name nobody anticipated. What must never happen is silence.
 */
export function unresolvableReason(recordCategory: string): string | null {
  if (resolutionFor(recordCategory) !== null) return null;
  const known = Object.entries(UNRESOLVABLE_REASONS).find(
    ([name]) => normaliseCategory(name) === normaliseCategory(recordCategory),
  );
  if (known) return known[1];
  return (
    'This system has not been told which records this category name means, so it cannot count them ' +
    'and will never raise a notice for it. The period you set is recorded and the statutory floor ' +
    'still applies to it — but nothing here is watching the clock.'
  );
}

/**
 * The floor whose article the notice cites for a category, if any.
 *
 * Re-exported through here rather than re-derived: the notice must cite the SAME article the refusal
 * cites, and two paths to that answer is two chances for a screen to name a different statute from
 * the one that refused a shorter period an hour earlier.
 */
export const floorForResolvedCategory = floorForCategory;
