import { ForbiddenException } from '@nestjs/common';
import {
  pairByConstraint,
  type MakerCheckerConstraint,
} from './maker-checker-pairs.config';

/**
 * Maker/checker segregation of duties (Part 5.2;
 * ibms-brain/meta/lex/maker-checker-segregation.md). "The person who makes
 * ... a high-risk action is never the same person who checks/approves it.
 * This is a hard system rule ... The system must enforce it structurally."
 *
 * Call this at every write path that records a checker decision — right
 * before persisting it, not only on read — so a self-approval can never
 * reach the database through that code path. It is one of two backstops:
 * this is the application-layer guard, a `CHECK` constraint on the same
 * column pair is the DB-layer one (see the
 * `add_maker_checker_check_constraints` migration in packages/db). Neither
 * substitutes for the other — but the database half is NO LONGER ABSOLUTE, and this is S3 of the
 * named short pass.
 *
 * It used to say: "a bug that skips this guard still can't write a self-approval, and a caller that
 * bypasses application code entirely (raw SQL, a future integration) still can't either." The
 * duty-segregation MODE lifted exactly that. Every one of the fifteen CHECK constraints gained a
 * third disjunct, measured on the live database:
 *
 *     CHECK ("approvedByUserId" IS NULL
 *            OR "approvedByUserId" <> "raisedByUserId"
 *            OR "combinedDutyActId" IS NOT NULL)      <-- added by 20261028100000
 *
 * So a write carrying an escape-column value IS accepted, by design: that is what lets a declared
 * one-person office function at all. A bug that skips this guard, or raw SQL, can therefore write a
 * self-approval IF it also supplies a `combinedDutyActId`.
 *
 * WHAT STILL BOUNDS IT, and it is why the design is sound rather than why the old sentence was:
 * a TRIGGER on `CombinedDutyAct` refuses an act whose office is not COMBINED. So in a SEGREGATED
 * office — which every office is unless it has declared otherwise — the escape column cannot be
 * populated at all, and the raw-SQL path is still closed. In a COMBINED office it is open, the act
 * is the record of who declared it and why, and the self-approval report is what surfaces it.
 *
 * The distinction matters to whoever reads this next: "the database refuses it" and "the database
 * refuses it unless the office has declared otherwise and the act exists" are different guarantees,
 * and only the second one is true.
 *
 * A checker id of `null`/`undefined` means "not yet decided" and is not a
 * violation — only an actual match with the maker id is rejected.
 *
 * ## Covered pairs: all of them, from one list
 *
 * `maker-checker-pairs.config.ts`. This header used to carry its own 11-row table while the database
 * enforces 15 — both `NeedsAssessment` pairs were missing from it, so a developer reading here would have
 * believed the set was smaller than it is. One list now, and
 * `test/maker-checker-pairs.e2e-spec.ts` derives the expected set from `pg_constraint` so a sixteenth
 * constraint cannot be added without that file moving.
 *
 * @param makerId the user id who performed the maker action (requested,
 *   captured, placed, nominated, raised, drafted, assessed, ...)
 * @param checkerId the user id being recorded as the checker (approved,
 *   checked, DPO-approved, ...) — `null`/`undefined` if not yet decided
 * @param context a short label identifying the call site for the error
 *   message, e.g. `"Refund.approve"` or `"KYCRecord.approve"`
 * @param constraint the CHECK constraint enforcing this pair, when the caller knows it — see below
 * @throws {ForbiddenException} if `checkerId` is set and equals `makerId`
 */
export function assertDifferentActors(
  makerId: string,
  checkerId: string | null | undefined,
  context: string,
  /**
   * Naming the pair is what lets the refusal name the REMEDY.
   *
   * Optional because 19 call sites predate it, and a refusal without a remedy is still a correct refusal —
   * passing it upgrades the message from a statement of the rule to something a person can act on. The type
   * is the constraint-name union from `maker-checker-pairs.config.ts`, so a typo is a compile error rather
   * than a message naming a permission nobody holds.
   */
  constraint?: MakerCheckerConstraint,
): void {
  if (checkerId != null && checkerId === makerId) {
    const pair = constraint ? pairByConstraint(constraint) : undefined;
    // WHAT TO DO, not only what went wrong.
    //
    // The old message stated the rule and stopped: "the checker must be a different user than the maker".
    // True, and useless to whoever is holding it — they cannot tell from it whether their office has anyone
    // else who could do this, or what to ask an administrator for. Naming the permission makes the next
    // step a sentence somebody can act on, and the readiness list is where they see who holds it.
    const remedy = pair
      ? ' A second person holding ' +
        pair.checkerPermission +
        ' has to do it — Settings, Roles & permissions lists who does, under the operations that need two people.'
      : '';
    throw new ForbiddenException(
      `${context}: the checker must be a different user than the maker (maker/checker segregation of duties — Part 5.2).${remedy}`,
    );
  }
}
