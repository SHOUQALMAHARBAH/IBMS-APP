-- Part 5.2 / meta/lex/maker-checker-segregation.md — "The system must
-- enforce it structurally ... not rely on a human remembering not to
-- self-approve." apps/api's assertDifferentActors() (common/maker-checker.util.ts)
-- is the application-layer guard called at every checker write path; these
-- CHECK constraints are the DB-layer backstop the lex file calls for, so a
-- write that reaches Postgres through any route (raw SQL, a future
-- integration, a bug that skips the guard) still cannot record a
-- self-approval.
--
-- Each constraint allows NULL on the checker column (not yet decided is not
-- a violation) and only rejects checker == maker once a checker is set.
-- Same known residual risk as the AuditLogEntry immutability trigger
-- (20260826083942): the app and Prisma Migrate currently share one
-- Postgres role, so `ALTER TABLE ... DISABLE TRIGGER` doesn't apply here
-- (CHECK constraints aren't triggers) but a superuser-equivalent role could
-- still `ALTER TABLE ... DROP CONSTRAINT`. A dedicated least-privilege app
-- role (without ALTER TABLE) is the real fix — same follow-up as noted there.

ALTER TABLE "KYCRecord"
  ADD CONSTRAINT "KYCRecord_maker_checker_distinct" CHECK (
    "approvedByUserId" IS NULL OR "approvedByUserId" <> "createdByUserId"
  );

ALTER TABLE "PolicyChecking"
  ADD CONSTRAINT "PolicyChecking_maker_checker_distinct" CHECK (
    "checkedByUserId" IS NULL OR "checkedByUserId" <> "placedByUserId"
  );

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_maker_checker_distinct" CHECK (
    "approvedByUserId" IS NULL OR "approvedByUserId" <> "raisedByUserId"
  );

ALTER TABLE "DisposalBatch"
  ADD CONSTRAINT "DisposalBatch_maker_checker_distinct" CHECK (
    "dpoApprovedByUserId" IS NULL OR "dpoApprovedByUserId" <> "nominatedByUserId"
  );

ALTER TABLE "DataSharingApproval"
  ADD CONSTRAINT "DataSharingApproval_maker_checker_distinct" CHECK (
    "approvedByUserId" IS NULL OR "approvedByUserId" <> "requestedByUserId"
  );

ALTER TABLE "DataProcessingAgreement"
  ADD CONSTRAINT "DataProcessingAgreement_maker_checker_distinct" CHECK (
    "dpoApprovedByUserId" IS NULL OR "assessedByUserId" IS NULL
    OR "dpoApprovedByUserId" <> "assessedByUserId"
  );

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_maker_checker_distinct" CHECK (
    "secondApproverUserId" IS NULL OR "approvedByUserId" IS NULL
    OR "secondApproverUserId" <> "approvedByUserId"
  );

ALTER TABLE "CommissionLedgerEntry"
  ADD CONSTRAINT "CommissionLedgerEntry_maker_checker_distinct" CHECK (
    "overrideApprovedByUserId" IS NULL OR "overrideRequestedByUserId" IS NULL
    OR "overrideApprovedByUserId" <> "overrideRequestedByUserId"
  );

ALTER TABLE "Recommendation"
  ADD CONSTRAINT "Recommendation_maker_checker_distinct" CHECK (
    "approvedByUserId" IS NULL OR "approvedByUserId" <> "draftedByUserId"
  );

-- Not in the lex table's illustrative list, but the same invariant already
-- guarded ad hoc in application code (access-recertification.service.ts
-- decide()) — extending the DB-level backstop to it too rather than leaving
-- it as the one approval flow without one.
ALTER TABLE "AccessRecertificationItem"
  ADD CONSTRAINT "AccessRecertificationItem_maker_checker_distinct" CHECK (
    "reviewerUserId" <> "subjectUserId"
  );
