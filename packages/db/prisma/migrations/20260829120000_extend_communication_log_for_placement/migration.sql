-- Backlog Part C #12 (Domain B, Process 12) — Market Placement.
-- Widen the Process-44 `CommunicationLog` model so it also carries
-- broker<->insurer correspondence during an RFQ's market phase ("answer
-- insurer queries and supply additional information"). All changes are
-- additive or NULL-relaxing; the table has no rows and no application code
-- referenced it before this item.

-- New direction enum. Existing/Process-44 rows are always outbound, so the
-- column below defaults to OUTBOUND.
CREATE TYPE "CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- A placement row is not customer-scoped (its customerId is backfilled from
-- the RFQ's Opportunity when known) and has no consent-language dimension.
-- Process 44 will always set both.
ALTER TABLE "CommunicationLog" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "CommunicationLog" ALTER COLUMN "languageUsed" DROP NOT NULL;

ALTER TABLE "CommunicationLog" ADD COLUMN "direction" "CommunicationDirection" NOT NULL DEFAULT 'OUTBOUND';
ALTER TABLE "CommunicationLog" ADD COLUMN "rfqId" TEXT;
ALTER TABLE "CommunicationLog" ADD COLUMN "rfqInsurerId" TEXT;
ALTER TABLE "CommunicationLog" ADD COLUMN "subject" TEXT;
ALTER TABLE "CommunicationLog" ADD COLUMN "body" TEXT;
ALTER TABLE "CommunicationLog" ADD COLUMN "loggedByUserId" TEXT;
ALTER TABLE "CommunicationLog" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Optional relations — Prisma's default referential actions for an optional
-- relation (the schema declares none explicitly and uses no relationMode).
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_rfqId_fkey"
  FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_rfqInsurerId_fkey"
  FOREIGN KEY ("rfqInsurerId") REFERENCES "RFQInsurer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CommunicationLog_customerId_idx" ON "CommunicationLog"("customerId");
CREATE INDEX "CommunicationLog_rfqId_idx" ON "CommunicationLog"("rfqId");
CREATE INDEX "CommunicationLog_rfqInsurerId_idx" ON "CommunicationLog"("rfqInsurerId");
