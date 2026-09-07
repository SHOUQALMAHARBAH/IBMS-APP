import { ForbiddenException } from '@nestjs/common';

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
 * substitutes for the other — a bug that skips this guard still can't write
 * a self-approval, and a caller that bypasses application code entirely
 * (raw SQL, a future integration) still can't either.
 *
 * A checker id of `null`/`undefined` means "not yet decided" and is not a
 * violation — only an actual match with the maker id is rejected.
 *
 * Covered pairs (Part 5.2 table + the M-series rules in `PRIV-SRS-01`):
 *
 * | Entity                    | Maker field                 | Checker field               |
 * |---------------------------|------------------------------|------------------------------|
 * | KYCRecord                 | createdByUserId              | approvedByUserId             |
 * | PolicyChecking            | placedByUserId                | checkedByUserId              |
 * | Refund                    | raisedByUserId                | approvedByUserId             |
 * | DisposalBatch             | nominatedByUserId             | dpoApprovedByUserId          |
 * | DataSharingApproval       | requestedByUserId             | approvedByUserId             |
 * | DataProcessingAgreement   | assessedByUserId               | dpoApprovedByUserId          |
 * | Settlement                | approvedByUserId               | secondApproverUserId         |
 * | CommissionLedgerEntry     | overrideRequestedByUserId      | overrideApprovedByUserId     |
 * | Recommendation            | draftedByUserId                | approvedByUserId             |
 * | AccessRecertificationItem | subjectUserId                  | reviewerUserId               |
 * | Complaint                 | resolvedByUserId               | closureApprovedByUserId      |
 *
 * @param makerId the user id who performed the maker action (requested,
 *   captured, placed, nominated, raised, drafted, assessed, ...)
 * @param checkerId the user id being recorded as the checker (approved,
 *   checked, DPO-approved, ...) — `null`/`undefined` if not yet decided
 * @param context a short label identifying the call site for the error
 *   message, e.g. `"Refund.approve"` or `"KYCRecord.approve"`
 * @throws {ForbiddenException} if `checkerId` is set and equals `makerId`
 */
export function assertDifferentActors(
  makerId: string,
  checkerId: string | null | undefined,
  context: string,
): void {
  if (checkerId != null && checkerId === makerId) {
    throw new ForbiddenException(
      `${context}: the checker must be a different user than the maker (maker/checker segregation of duties — Part 5.2)`,
    );
  }
}
