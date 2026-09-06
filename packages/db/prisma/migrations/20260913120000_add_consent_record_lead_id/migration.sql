-- Part D §5.1 — Consent Management (M03), touchpoint wiring. Lead capture
-- (backlog Process #1) is the one of the seven named consent touchpoints
-- that pre-dates a Customer/InsuredPerson row existing at all — this widens
-- ConsentRecord with a third, optional owner column so a lead-stage
-- marketing-consent decision lands in the SAME register as every other
-- touchpoint, rather than staying a plain Lead.marketingConsentGranted
-- boolean invisible to the DPO's consent register / withdrawal SLA.
--
-- Exactly one of customerId/insuredPersonId/leadId is validated at the
-- SERVICE layer (consent.config.ts's hasExactlyOneConsentOwner), not a DB
-- CHECK — the same rationale ConsentRecord's existing two-owner pair already
-- documents: a ConsentRecord is written by one call site, once, never
-- edited afterward, so there is no concurrent-write race to guard against.

ALTER TABLE "ConsentRecord"
  ADD COLUMN IF NOT EXISTS "leadId" TEXT;

DO $$ BEGIN
  ALTER TABLE "ConsentRecord"
    ADD CONSTRAINT "ConsentRecord_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ConsentRecord_leadId_idx"
  ON "ConsentRecord" ("leadId");
