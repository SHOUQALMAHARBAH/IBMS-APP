-- Process 27 — Claim Follow-up (insurer non-response).
--
-- RACE-SAFE INVARIANT (ibms-brain/meta/lex/race-safe-invariants.md): at most
-- ONE unresolved ClaimFollowUpAlert per claim. The nightly sweep and an
-- on-demand re-run must not mint a duplicate open alert for the same claim,
-- and neither may two concurrent sweeps. A partial UNIQUE index is the
-- structural guard; Prisma cannot express the WHERE in schema.prisma, so this
-- is hand-authored. Once an alert is resolved (resolvedAt set) it leaves the
-- index, so a claim that is chased again later can get a fresh alert.
CREATE UNIQUE INDEX IF NOT EXISTS "ClaimFollowUpAlert_one_open_per_claim"
  ON "ClaimFollowUpAlert" ("claimId")
  WHERE "resolvedAt" IS NULL;

-- Supports the resolve pass: open alerts joined to their claim's status.
CREATE INDEX IF NOT EXISTS "ClaimFollowUpAlert_claimId_idx"
  ON "ClaimFollowUpAlert" ("claimId");
