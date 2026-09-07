-- Part D §5.1, Process #52 — closes a real gap between two Part D systems:
-- DSR (M04) blocked a Deletion request from closing "fully fulfilled"
-- while a retention flag was open using ONLY a staff attestation
-- (`confirmNoOpenRetentionHold`), because at the time it shipped, Legal
-- Hold (M06) held no structured reference to which data subject a hold
-- covers — `scope` is free text. M06 has since shipped a real, live
-- register; this widens LegalHold with an optional, structured subject
-- reference (at most one of customerId/insuredPersonId — validated at the
-- service layer, the ConsentRecord/DataSubjectRequest precedent) so
-- DsrService.fulfil() can run a REAL live check against this register
-- instead of trusting the checkbox alone.

ALTER TABLE "LegalHold"
  ADD COLUMN IF NOT EXISTS "customerId" TEXT,
  ADD COLUMN IF NOT EXISTS "insuredPersonId" TEXT;

DO $$ BEGIN
  ALTER TABLE "LegalHold"
    ADD CONSTRAINT "LegalHold_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "LegalHold"
    ADD CONSTRAINT "LegalHold_insuredPersonId_fkey"
    FOREIGN KEY ("insuredPersonId") REFERENCES "InsuredPerson"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "LegalHold_customerId_idx"
  ON "LegalHold" ("customerId");
CREATE INDEX IF NOT EXISTS "LegalHold_insuredPersonId_idx"
  ON "LegalHold" ("insuredPersonId");
