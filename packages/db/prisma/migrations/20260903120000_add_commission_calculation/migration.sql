-- Process 35 — Commission Calculation (backlog Part C #35, Domain D).
--
-- Three structural invariants for the governed commission machinery. The
-- CommissionAgreement / CommissionLedgerEntry models, the
-- CommissionLedgerEntry_maker_checker_distinct CHECK (migration
-- 20260826091424) and the four Finance commission perms (commission.calculate,
-- commission-rate.manage, commission-override.raise / .approve) all already
-- existed.
--
-- 1. AT MOST ONE currently-open CommissionAgreement per (insurer, line).
--    "The correct rate by insurer + line" only has one answer if there is a
--    single open (effectiveTo IS NULL) agreement for the pair — a rate change
--    closes the prior window and opens a new one. A read-then-create cannot
--    hold this under a concurrent POST /commission/agreements
--    (ibms-brain/meta/lex/race-safe-invariants.md). Prisma cannot express a
--    predicate UNIQUE, so it lives here in raw SQL.
--
-- 2. ONE CommissionLedgerEntry per policy. #35 records the single
--    new-business commission entry per policy (write-once — the #31 Invoice
--    new-business partial UNIQUE pattern); a concurrent / retried
--    POST /commission/entries must not mint two. Renewal / a second entry
--    type would relax this to a discriminated constraint (renewal is not
--    built).
--
-- 3. overrideAmount — the PROPOSED manual-override amount, held separately
--    from `amount` (the governed figure) until the override is APPROVED. The
--    approve step copies overrideAmount into `amount`; a pending override
--    leaves `amount` untouched.

CREATE UNIQUE INDEX IF NOT EXISTS "CommissionAgreement_one_open_per_insurer_line"
  ON "CommissionAgreement" ("insurerId", "insuranceLine")
  WHERE "effectiveTo" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "CommissionLedgerEntry_policyId_key"
  ON "CommissionLedgerEntry" ("policyId");

ALTER TABLE "CommissionLedgerEntry"
  ADD COLUMN IF NOT EXISTS "overrideAmount" DECIMAL(18,3);
