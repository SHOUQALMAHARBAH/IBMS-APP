-- Process 44 — Customer Communication (backlog Part C #44, Domain E).
-- Widens the pre-existing `Customer` and `CommunicationLog` — no new table.

-- The customer's recorded outbound-communication channel preference. Language
-- already lives in `Customer.languagePreference`.
ALTER TABLE "Customer" ADD COLUMN "preferredContactChannel" "InteractionChannel";

-- A marketing send (the `ConsentRecord` gate applies) vs a service /
-- transactional message; and the marketing consent record relied on at send
-- time (null for a non-marketing send).
ALTER TABLE "CommunicationLog" ADD COLUMN "isMarketing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CommunicationLog" ADD COLUMN "consentRecordId" TEXT;

ALTER TABLE "CommunicationLog"
  ADD CONSTRAINT "CommunicationLog_consentRecordId_fkey"
  FOREIGN KEY ("consentRecordId") REFERENCES "ConsentRecord"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The Process-44 "this customer's communications, newest first" read. Replaces
-- the bare (customerId) index — still a usable left-prefix for the #12 path.
DROP INDEX "CommunicationLog_customerId_idx";
CREATE INDEX "CommunicationLog_customerId_sentAt_idx" ON "CommunicationLog"("customerId", "sentAt");
CREATE INDEX "CommunicationLog_consentRecordId_idx" ON "CommunicationLog"("consentRecordId");
