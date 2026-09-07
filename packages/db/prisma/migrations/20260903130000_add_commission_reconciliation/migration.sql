-- Process 36 — Commission Reconciliation (backlog Part C #36, Domain D).
--
-- #35 recorded the ONE governed CommissionLedgerEntry per policy at
-- `status = 'outstanding'` with `vatAmount = 0`. #36 gives the entry the rest
-- of its lifecycle — VAT on the commission, the `outstanding -> paid` (an
-- insurer statement reconciled) and `-> reversed` (a negative / cancellation
-- endorsement clawed the commission back) moves, and the figures the backlog
-- line asks for: rate / amount / tax / paid / outstanding / reversed.
--
-- 1. CommissionAgreement.vatRatePercent — VAT (Jordan GST on the broker's
--    commission income) is GOVERNED alongside the commission rate: Compliance /
--    Manager set it on the (insurer, line) window, Finance only applies it.
--    DECIMAL(5,2) mirrors `ratePercent`. Defaults 0 so every pre-existing
--    window keeps `vatAmount = 0` until a rate manager sets a real figure.
--
-- 2. CommissionLedgerEntry.vatRatePercent — the VAT rate SNAPSHOTTED onto the
--    entry when commission is calculated (the #23 / #27 advisory-snapshot
--    pattern), so `vatAmount == amount x vatRatePercent%` is a self-consistent
--    on-row invariant that survives a later manual override (approve recomputes
--    `vatAmount` from the pinned `overrideAmount` x this frozen rate) and a
--    later edit to the governed CommissionAgreement.
--
-- 3. paidAmount / paidAt / paymentReference — the reconciliation outcome:
--    which insurer statement / payment settled the entry and for how much
--    (must equal `amount` exactly — a variance is a Process 39
--    ReconciliationException, never a silent write-off).
--
-- 4. reversedAmount / reversedAt / reversalReason — the clawback outcome:
--    stamped when a negative / cancellation Endorsement (Process 22) mints a
--    CommissionReversal for the policy. `reversedAmount` accumulates the
--    reversed portions; `status` flips to 'reversed' once the full earned
--    commission has been clawed back.

ALTER TABLE "CommissionAgreement"
  ADD COLUMN IF NOT EXISTS "vatRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

ALTER TABLE "CommissionLedgerEntry"
  ADD COLUMN IF NOT EXISTS "vatRatePercent"   DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paidAmount"       DECIMAL(18,3),
  ADD COLUMN IF NOT EXISTS "paidAt"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentReference" TEXT,
  ADD COLUMN IF NOT EXISTS "reversedAmount"   DECIMAL(18,3),
  ADD COLUMN IF NOT EXISTS "reversedAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reversalReason"   TEXT;
