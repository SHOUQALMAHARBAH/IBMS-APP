-- Backlog Part C #18-19 — Policy Placement & Issuance. The `Policy` /
-- `PolicySchedule` / `Document` models already existed (big migration
-- 20260825124114). This adds:
--
--   1. Policy provenance scalars — placedByUserId (the Placement Officer who
--      bound the cover, set at #18 placement) and issuedByUserId (stamped on
--      the PLACEMENT_CONFIRMED -> ISSUED transition at #19). Bare TEXT, no FK;
--      the AuditLogEntry CREATE / TRANSITION rows are authoritative (same
--      pattern as Opportunity.createdByUserId / RFQ.issuedByUserId).
--
--   2. A partial UNIQUE index enforcing "at most one OPEN coverage schedule
--      (effectiveTo IS NULL) per Policy" as a real DB invariant, not a
--      read-then-write pre-check (ibms-brain/meta/lex/race-safe-invariants.md).
--      Prisma cannot express a partial UNIQUE in schema.prisma, so it is raw
--      SQL here + a /// note on model PolicySchedule. It backstops the
--      crash-recovery re-entry branch in PolicyService.recordIssuance and the
--      schedule versioning a future Endorsement module (#22) will drive.

ALTER TABLE "Policy" ADD COLUMN "placedByUserId" TEXT;
ALTER TABLE "Policy" ADD COLUMN "issuedByUserId" TEXT;

CREATE UNIQUE INDEX "PolicySchedule_one_open_per_policy"
  ON "PolicySchedule" ("policyId")
  WHERE "effectiveTo" IS NULL;
