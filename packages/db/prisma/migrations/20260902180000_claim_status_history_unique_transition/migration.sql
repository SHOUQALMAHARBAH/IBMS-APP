-- Backlog Part C #24 follow-up — code-review MINOR.
--
-- "At most one ClaimStatusHistory row per (claimId, toStatus)" is a race-safe
-- invariant (ibms-brain/meta/lex/race-safe-invariants.md). Process 24's
-- `ClaimRepository.recordRegistration` guards the REGISTERED history-row insert
-- with a `count()`-then-`if`-then-`create` (a check-then-act) — today that is
-- transitively backstopped by the sibling `Adjuster.claimId @unique` inside the
-- same `$transaction`, but the invariant should be structural, not emergent.
--
-- The `WORKFLOW_TRANSITIONS.Claim` map is an acyclic DAG (NOTIFIED -> REGISTERED
-- -> DOCUMENTATION_IN_PROGRESS -> UNDER_ASSESSMENT -> APPROVED|PARTIALLY_APPROVED
-- |DECLINED -> SETTLED -> CLOSED) — no status is ever revisited — so a claim
-- enters each status exactly once and this UNIQUE is correct over the whole
-- lifecycle. It also keeps the `count()` pre-check useful (the crash-recovery
-- resume path legitimately finds the REGISTERED row already present and must
-- skip the insert rather than hit this constraint).

CREATE UNIQUE INDEX "ClaimStatusHistory_claimId_toStatus_key"
  ON "ClaimStatusHistory" ("claimId", "toStatus");
