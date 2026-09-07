-- Part F item #6 — full-text search across Arabic and English (fuzzy
-- transliteration matching and same-script typo tolerance both explicitly
-- deferred as future work, by user decision). Adds one GENERATED STORED
-- tsvector column + GIN index per model, on the 3 entities that have both
-- a genuinely bilingual name field AND an existing list endpoint + web
-- list page: Customer, Prospect, Vendor. `Insurer` deliberately excluded —
-- it has no dedicated module or web list page anywhere in this app yet.
--
-- Each column concatenates the SAME source text run through both the
-- built-in 'arabic' and 'english' Postgres text-search configs
-- (`to_tsvector('arabic', x) || to_tsvector('english', x)`) — empirically
-- verified against this exact Postgres build that each config tokenizes
-- text from the OTHER script without error (passing it through largely
-- unstemmed rather than dropping it), so the combined vector correctly
-- matches both a real Arabic stem and an English word from the same
-- bilingual field.
--
-- Customer: from legalName ONLY — contactPhoneEnc/contactEmailEnc are
-- Highly Confidential -- ENCRYPT fields and must never be indexed in
-- plaintext (sensitive-data-handling.md).
-- Prospect: from companyName + contactPerson (each coalesced to '' so a
-- NULL contactPerson doesn't null out the whole vector).
-- Vendor: from name.
--
-- No backfill needed: GENERATED ALWAYS ... STORED computes the value for
-- every existing row the moment the column is added.

ALTER TABLE "Customer" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('arabic', coalesce("legalName", '')) ||
    to_tsvector('english', coalesce("legalName", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS "Customer_searchVector_idx"
  ON "Customer" USING GIN ("searchVector");

ALTER TABLE "Prospect" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('arabic', coalesce("companyName", '') || ' ' || coalesce("contactPerson", '')) ||
    to_tsvector('english', coalesce("companyName", '') || ' ' || coalesce("contactPerson", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS "Prospect_searchVector_idx"
  ON "Prospect" USING GIN ("searchVector");

ALTER TABLE "Vendor" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('arabic', coalesce("name", '')) ||
    to_tsvector('english', coalesce("name", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS "Vendor_searchVector_idx"
  ON "Vendor" USING GIN ("searchVector");
