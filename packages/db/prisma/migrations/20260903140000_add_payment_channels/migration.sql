-- Process 38 — Payment Processing (backlog Part C #38, Domain D).
--
-- "Record approved payment channels for customers and insurers" (Part 3.6).
-- A governed reference list Finance maintains; #32's collection cycle records
-- WHICH approved channel a Receipt / Remittance used.
--
-- Masked-only: no full bank account / card number is stored anywhere
-- (ibms-brain/meta/lex/sensitive-data-handling.md — bank/card data is Highly
-- Confidential, never stored/logged/displayed unmasked). `accountLast4` is the
-- permitted masked form.
--
-- `PaymentChannel_owner_exactly_one` CHECK: exactly one of
-- (customerId, insurerId) is set and matches `ownerType` — the service
-- validates it, this is the structural backstop.

CREATE TABLE "PaymentChannel" (
  "id"           TEXT NOT NULL,
  "ownerType"    TEXT NOT NULL,
  "customerId"   TEXT,
  "insurerId"    TEXT,
  "channelType"  TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "bankName"     TEXT,
  "accountLast4" TEXT,
  "currency"     TEXT NOT NULL DEFAULT 'JOD',
  "status"       TEXT NOT NULL DEFAULT 'active',
  "disabledAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentChannel_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaymentChannel" ADD CONSTRAINT "PaymentChannel_owner_exactly_one" CHECK (
  ("ownerType" = 'customer' AND "customerId" IS NOT NULL AND "insurerId" IS NULL) OR
  ("ownerType" = 'insurer'  AND "insurerId"  IS NOT NULL AND "customerId" IS NULL)
);

CREATE INDEX "PaymentChannel_ownerType_customerId_idx" ON "PaymentChannel"("ownerType", "customerId");
CREATE INDEX "PaymentChannel_ownerType_insurerId_idx"  ON "PaymentChannel"("ownerType", "insurerId");

-- ON DELETE RESTRICT (not SET NULL): SET NULL would violate the
-- `PaymentChannel_owner_exactly_one` CHECK when a referenced Customer / Insurer
-- is hard-deleted. A deliberate RESTRICT — an M06 disposal batch must remove
-- the customer's channels before the customer row.
ALTER TABLE "PaymentChannel" ADD CONSTRAINT "PaymentChannel_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentChannel" ADD CONSTRAINT "PaymentChannel_insurerId_fkey"
  FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Receipt"    ADD COLUMN "paymentChannelId" TEXT;
ALTER TABLE "Remittance" ADD COLUMN "paymentChannelId" TEXT;

ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentChannelId_fkey"
  FOREIGN KEY ("paymentChannelId") REFERENCES "PaymentChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Remittance" ADD CONSTRAINT "Remittance_paymentChannelId_fkey"
  FOREIGN KEY ("paymentChannelId") REFERENCES "PaymentChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
