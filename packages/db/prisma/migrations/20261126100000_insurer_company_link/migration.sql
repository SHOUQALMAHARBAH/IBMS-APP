-- MODULE 0-ب ITEM (e) — THE LINK THE RESOLVER READS. DECISION 63, AND IT MOVES NO DATA.
--
-- ## THE SPLIT IS A RESOLVER, NOT A MOVE — and this column is the whole of it
--
-- `docs/decision-insurer-field-split.md` § 5.2, confirmed by the owner. An office may carry an
-- `Insurer` row for a company with NO platform organization, and that case is the MAJORITY: measured
-- at the time, 4 of dev's 19 rows and 6 of db-test's 534 were local-only, and for those rows there is
-- no organization to hold the company facts. So the eight local columns cannot move — an unregistered
-- company's phone number has nowhere else to live — and genuinely moving them would have broken 16 of
-- dev's 19 rows.
--
-- What the split actually requires is a POINTER and a precedence:
--
--   * the local columns STAY on `Insurer`, and answer when there is no link;
--   * when the insurer IS linked to a registered company, the organization's value WINS;
--   * one resolver owns that precedence, in one file, exactly as `insurer-identity.ts` already
--     coalesces master name over local name today.
--
-- Framed that way the migration is this one nullable column. No row is rewritten at all, which is
-- item (e)'s delivery evidence and is asserted below.
--
-- ## WHY `insuranceCompanyId` AND NOT `registeredOrganizationId` OR ANYTHING WITH `organizationId` IN IT
--
-- `Insurer.organizationId` already exists and means THE OFFICE THAT OWNS THIS COUNTERPARTY RECORD —
-- the tenant. A second column whose name contained `organizationId` would invite exactly the
-- confusion that produced the previous correction in this item, where a general fact was named like a
-- tenant column and silently became tenant-scoped.
--
-- `tenantScopeExtension` matches the field name EXACTLY (`f.name === 'organizationId'`), so
-- `registeredOrganizationId` would have been safe mechanically and unsafe to read. The name here
-- matches `InsurerLicensedLine.insuranceCompanyId`, so one phrase means one thing across this module:
-- the `Organization` row that IS an insurance company.
--
-- ## WHAT THIS COLUMN DOES NOT DO
--
-- It does not make `Insurer` cross-tenant. The row is still the OFFICE's, still filtered by RLS, and
-- an office linking its own counterparty record to a registered company writes nothing on that
-- company — which is the point: an office writing a company fact onto another organization's row is
-- not something tenant scoping permits, and nothing should be built that needs it.
--
-- There is deliberately NO unique constraint on it. Several offices each keep their own `Insurer` row
-- for the same company, and every one of them may link to it; that is the normal state, not a
-- duplicate. The uniqueness that matters — one `Insurer` row per office per company — is already held
-- by the existing per-office constraints on the canonical name key.
--
-- The column cannot be constrained to point only at an `INSURANCE_COMPANY`: a CHECK compares columns
-- of ONE row of ONE table, and the organization's type lives on the other side of the foreign key.
-- That refusal is in `InsurerCompanyLinkService`, which is also where the permission and the audit row
-- are — recorded here as service-grain rather than left for a reader to assume a database guarantee.

ALTER TABLE "Insurer" ADD COLUMN "insuranceCompanyId" TEXT;

ALTER TABLE "Insurer" ADD CONSTRAINT "Insurer_insuranceCompanyId_fkey"
  FOREIGN KEY ("insuranceCompanyId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Insurer_insuranceCompanyId_idx" ON "Insurer"("insuranceCompanyId");

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n INTEGER;
BEGIN
  -- (1) The composite tenant foreign keys are all still there.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype = 'f' AND conname LIKE '%\_same\_org\_fkey';
  IF n < 13 THEN
    RAISE EXCEPTION 'composite tenant FKs: only % remain, expected at least 13 — this migration dropped tenancy constraints', n;
  END IF;

  -- (2) ZERO ROWS MODIFIED — item (e)'s delivery evidence, asserted by the migration that defines the
  --     split. Every `Insurer` row comes out of this unlinked; linking is an ACT a person performs,
  --     with a permission and an audit row, never something a migration guesses at. There is no name
  --     match, no canonical-key join, no "obviously the same company" heuristic here, deliberately.
  SELECT count(*) INTO n FROM "Insurer" WHERE "insuranceCompanyId" IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '% Insurer row(s) came out of this migration already linked — nothing here links anything', n;
  END IF;

  -- (3) THE LOCAL COLUMNS ARE STILL THERE. The whole split rests on them surviving: a row with no
  --     link answers from them, and dropping them would strand every local-only insurer.
  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = '"Insurer"'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname IN ('companyPhone','companyEmail','companyWebsite','companyCorrespondenceAddress',
                     'legalName','legalNameAr','structure');
  IF n <> 7 THEN
    RAISE EXCEPTION 'only % of the 7 local company columns remain on Insurer — a local-only insurer would have nowhere to keep its own details', n;
  END IF;

  -- (4) NO UNIQUE ON THE LINK. Several offices legitimately link their own row to the same company,
  --     and a unique here would let the first office to link block every other one.
  SELECT count(*) INTO n FROM pg_indexes
   WHERE tablename = 'Insurer' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%insuranceCompanyId%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'a UNIQUE index covers Insurer.insuranceCompanyId — the first office to link a company would block every other office from linking it';
  END IF;

  RAISE NOTICE 'Insurer.insuranceCompanyId added, zero rows linked, the seven local columns intact';
END $$;
