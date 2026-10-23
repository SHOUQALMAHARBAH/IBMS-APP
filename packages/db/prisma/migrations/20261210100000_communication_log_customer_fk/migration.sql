-- MODULE 0-ب, BATCH SIX ITEM 4 — `CommunicationLog.customerId` gets its relation and its key.
--
-- Register entry 125. The column was a bare `String?` with NO `@relation` and NO foreign key,
-- while `rfqId`, `rfqInsurerId` and `consentRecordId` on the SAME model all have real relations.
-- So a communication row could name a customer that does not exist and nothing refused it — the
-- `Customer.ownerUserId` shape one table over (entry 63).
--
-- IT BECAME URGENT RATHER THAN MERELY UNTIDY in batch five: item 1(a) made this column the source
-- of a NAME ON SCREEN. An unanchored id is a curiosity while nothing reads it and a lie the moment
-- something does.
--
-- ORPHANS MEASURED BEFORE THE CONSTRAINT, because a migration that fails on real rows is worse
-- than a reported gap:
--
--     dev      0 CommunicationLog rows at all
--     db-test  12 rows, all 12 carrying a customerId, ZERO orphaned, ZERO cross-tenant
--     seed     writes NO CommunicationLog row at all (`git grep communicationLog` in
--              `packages/db/prisma` finds only the two back-relation declarations)
--
-- So there is nothing to backfill and no row to decide about. The DO block below still asserts it,
-- so a database this was not measured on fails with a COUNT and a name rather than an opaque
-- foreign-key violation naming neither.
--
-- ON DELETE SET NULL, AND THE SIBLING ON THIS MODEL IS WHY
-- -------------------------------------------------------
-- `consentRecordId` on this same table is already `SET NULL`, with the reason written beside it:
-- "the log row outlives the consent record it referenced". A communication log is the record that
-- a message WAS SENT — it carries `respectedConsent`, `isMarketing` and the consent row relied on,
-- which is PDPL evidence — so the row must survive whatever happens to the people it names.
--
--   CASCADE would destroy that evidence when a customer is erased.
--   RESTRICT would make a customer with any send history undeletable, adding a blocker to the one
--            table every DSR erasure path already has to fight (KYCRecord is RESTRICT already).
--   SET NULL keeps the row, and the integrity defect entry 125 names — an id pointing at nothing —
--            is closed by the KEY, not by the delete rule. Either choice closes it identically.
--
-- THE COST OF SET NULL, STATED: the screen's "no customer" cell now has two causes it cannot tell
-- apart — never set, or set and later erased. That is honest rather than lossy, because after a
-- SET NULL there genuinely is no customer to name; what it is NOT is a dangling id pretending to
-- resolve.
--
-- WHAT IS DELIBERATELY NOT DONE: a composite `(customerId, organizationId)` tenant foreign key,
-- the shape `RetentionExtension` uses so one office cannot cite another office's row. Measured, it
-- would need a NEW `@@unique([id, organizationId])` on `Customer` — which has none — plus a
-- `db:divergence` expectation, on a table holding 1,536 rows on dev. Both tables are already RLS
-- scoped by organization and the cross-tenant count measured ZERO on both databases, so the plain
-- key is proportionate and the stronger version is reported rather than smuggled in.

DO $$
DECLARE
  orphan_count INT;
  cross_tenant INT;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM "CommunicationLog" c
  WHERE c."customerId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "Customer" cu WHERE cu.id = c."customerId");

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'CommunicationLog.customerId: % row(s) name a Customer that does not exist. The foreign key '
      'cannot be added until each is decided — null it (the column is nullable and SET NULL is the '
      'delete rule anyway) or delete the log row. Measured ZERO on dev and db-test when this '
      'migration was written, so a non-zero count here is a database nobody measured.',
      orphan_count;
  END IF;

  -- Not a constraint, a REPORT: the plain key cannot refuse a cross-office reference, and this is
  -- the number that would decide whether the composite tenant key is worth its own migration.
  SELECT count(*) INTO cross_tenant
  FROM "CommunicationLog" c
  JOIN "Customer" cu ON cu.id = c."customerId"
  WHERE cu."organizationId" <> c."organizationId";

  RAISE NOTICE 'CommunicationLog.customerId: 0 orphans, % cross-office reference(s)', cross_tenant;
END $$;

ALTER TABLE "CommunicationLog"
  ADD CONSTRAINT "CommunicationLog_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The key is asserted BY ITS DELETE RULE, not merely by its existence: a constraint recreated as
-- CASCADE would keep this name and silently start destroying send evidence, and a RESTRICT one
-- would keep this name and silently start blocking erasures.
DO $$
DECLARE
  delete_rule TEXT;
BEGIN
  SELECT rc.delete_rule INTO delete_rule
  FROM information_schema.referential_constraints rc
  WHERE rc.constraint_name = 'CommunicationLog_customerId_fkey';

  IF delete_rule IS NULL THEN
    RAISE EXCEPTION 'CommunicationLog_customerId_fkey does not exist';
  END IF;
  IF delete_rule <> 'SET NULL' THEN
    RAISE EXCEPTION
      'CommunicationLog_customerId_fkey is % and must be SET NULL — CASCADE destroys send '
      'evidence and RESTRICT blocks a DSR erasure. See this migration''s header.', delete_rule;
  END IF;
END $$;
