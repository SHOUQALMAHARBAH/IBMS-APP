-- DUPLICATE PREVENTION: a SECOND canonical key, because a person is not a company.
--
-- WHAT WAS THERE
-- --------------
-- Nothing. Measured before writing a line of this: `Customer` carried exactly two unique indexes and
-- neither was about the person — its own primary key, and `prospectId`, which stops one PROSPECT
-- becoming two customers and is NULL for every customer onboarded directly. `legalName` had a plain
-- index for lookup speed. `CustomerService.create` threw one ConflictException and it was about the
-- prospect. The bulk import deduplicated nothing at all, which is the path that creates duplicates at
-- volume. `UltimateBeneficialOwner` and `Employee` had no uniqueness either.
--
-- So the same natural person could be registered twice as a customer, twice as a beneficial owner and
-- twice as an employee, and the heaviest consequence is not an untidy register: a duplicated customer
-- makes a PDPL data-subject request UNANSWERABLE TRUTHFULLY, because deletion or access is fulfilled
-- against the record somebody found and nothing reports that a second exists.
--
-- Meanwhile the insurer registry has refused a duplicate under a different spelling since migration
-- 20261013100000. The machinery existed and was used nowhere else.
--
-- ============================================================================================
-- WHY A SECOND FUNCTION, AND NOT `canonical_name_key`
-- ============================================================================================
-- The instruction was to reuse the insurer canonicalisation for people. Measured first, and it was
-- wrong — which is the whole reason this migration has two functions rather than one new index.
--
-- `canonical_name_key` SORTS ITS TOKENS. Verified against this database:
--
--     canonical_name_key('إبراهيم رشيد سالم التميمي')  ->  'ابراهيم تميمي رشيد سالم'
--     canonical_name_key('إبراهيم سالم رشيد التميمي')  ->  'ابراهيم تميمي رشيد سالم'   -- SAME KEY
--
-- Those are TWO DIFFERENT PEOPLE. A Jordanian name is given + father + grandfather + family, so
-- swapping the middle two names a different ancestry: Ibrahim son of Rashid son of Salem, against
-- Ibrahim son of Salem son of Rashid. Cousins, in a family that reuses given names — which here is the
-- norm and not the exception.
--
-- For a COMPANY the sort is correct and stays:
--
--     canonical_name_key('Al-Yarmouk Insurance Company')  =  canonical_name_key('Insurance Company Al-Yarmouk')
--
-- MEASURED CONSEQUENCE on 1,634 seeded individuals:
--
--     token-sorted key     15 collisions (0.92%)  —  8 of them cousins, wrongly merged
--     order-preserving     7  collisions (0.43%)  —  0 false; every one an identical spelling
--
-- The wrong key refuses twice as many people and half of them are real, different customers. On the
-- create screen it would have warned an officer about their own customer's cousin.
--
-- The rule this instances: WHAT COUNTS AS NOISE IN ONE ENTITY MAY BE THE DISTINGUISHING INFORMATION IN
-- ANOTHER. Reusing a mechanism means measuring it on the new entity first; being correct where it was
-- born is not evidence.
--
-- ============================================================================================
-- THE PERSON KEY
-- ============================================================================================
-- Identical character folding to `canonical_name_key` — diacritics and tatweel stripped, alef variants
-- and alef maqsura and teh marbuta folded, the Arabic definite article removed where three more Arabic
-- letters follow, punctuation treated as a separator — and the tokens joined IN THEIR ORIGINAL ORDER.
--
-- It inherits the same two locale dependencies, enumerated because IMMUTABLE has to be honest:
-- `lower()` is CTYPE-sensitive, and `[^[:alnum:][:space:]]` is CTYPE-dependent — under a `C` CTYPE every
-- Arabic letter is punctuation and every Arabic name keys to the EMPTY STRING. The database therefore
-- REQUIRES a UTF-8 CTYPE, which `canonical-name-key-parity.e2e-spec.ts` already asserts behaviourally.
-- There is NO `COLLATE "C"` here because there is no sort to protect: the order is the ordinal position
-- of each token, which no library upgrade changes.
CREATE OR REPLACE FUNCTION canonical_person_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $fn$
  SELECT coalesce(
    array_to_string(
      ARRAY(
        SELECT stripped
        FROM (
          SELECT
            regexp_replace(tok, '^ال(?=[؀-ۿ]{3,})', '') AS stripped,
            ord
          FROM unnest(
                 regexp_split_to_array(
                   regexp_replace(
                     translate(
                       regexp_replace(lower(value), '[ً-ْٰـ]', '', 'g'),
                       'آأإٱىة',
                       'اااايه'
                     ),
                     '[^[:alnum:][:space:]]', ' ', 'g'
                   ),
                   '\s+'
                 )
               ) WITH ORDINALITY AS t(tok, ord)
          WHERE tok <> ''
        ) t
        WHERE stripped <> ''
        -- THE ORDER IS THE ANCESTRY. This is the one line that differs from `canonical_name_key`, and
        -- it is the entire reason this function exists.
        ORDER BY ord
      ),
      ' '
    ),
    ''
  )
$fn$;

COMMENT ON FUNCTION canonical_person_key(text) IS
  'The single definition of "are these two PEOPLE the same person, by name". Same folding as canonical_name_key with WORD ORDER PRESERVED, because a Jordanian name is given + father + grandfather + family and swapping the middle two names a different ancestry — two cousins, not one person. Backs the bulk import''s hard duplicate refusal, the create screen''s warning, and the uniqueness of a beneficial owner within one customer and of an ACTIVE employee within one office. Never use canonical_name_key on a person, and never use this on a company: for a company word order is noise and the sort is correct.';

-- ============================================================================================
-- 1. THE COMPANY KEY — a hard unique on the canonicalised registration number
-- ============================================================================================
-- The number is PUBLIC: Jordan's Companies Control Department lets anyone look it up, so nothing is
-- traded away by indexing it, and the earlier decision to MASK it was reversed for that reason. What
-- matters for a company is not confidentiality but uniqueness.
--
-- `canonical_name_key` is the right function here — it strips the dashes and spaces a number is written
-- with inconsistently, and its token sort is harmless on a single token.
--
-- PARTIAL, on `registrationNumber IS NOT NULL`. Measured: db-test holds 564 corporate rows with no
-- registration number, all e2e fixtures writing through Prisma and bypassing the DTO that requires it,
-- so a NOT NULL could not be added over them. On dev the figure is 0 — every real corporate customer
-- would be keyed.
--
-- PRE-FLIGHT, because an opaque index failure during a deploy is the expensive way to learn this.
DO $$
DECLARE
  dupes int;
  sample text;
BEGIN
  SELECT count(*), min(k) INTO dupes, sample FROM (
    SELECT canonical_name_key("registrationNumber") AS k
    FROM "Customer"
    WHERE "customerType" = 'CORPORATE' AND "registrationNumber" IS NOT NULL
    GROUP BY "organizationId", canonical_name_key("registrationNumber")
    HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'duplicate-prevention: % canonical registration number(s) are already held by more than one corporate customer in one office (e.g. "%"). The unique index below cannot be created over them. These are DATA, not a bug to work around — report them and let the office decide, and never resolve one by deleting a row.',
      dupes, sample;
  END IF;
END $$;

CREATE UNIQUE INDEX "Customer_one_company_per_registration_number"
  ON "Customer" ("organizationId", (canonical_name_key("registrationNumber")))
  WHERE "customerType" = 'CORPORATE' AND "registrationNumber" IS NOT NULL;

-- ============================================================================================
-- 2. THE BENEFICIAL OWNER — unique WITHIN ONE CUSTOMER, never within the office
-- ============================================================================================
-- `(customerId, …)` and NOT `(organizationId, …)`, and the difference is the whole of it: THE SAME
-- PERSON BEING A BENEFICIAL OWNER OF TWO DIFFERENT COMPANIES IS ENTIRELY LEGITIMATE and must not be
-- refused. An office-shaped key would have refused it, which is why this was reported rather than
-- extended from the customer decision.
--
-- Keyed on the ordered NAME rather than on a fingerprint of the identity number. `nationalIdEnc` is
-- NOT NULL here, so every row carries a number — and none of them is comparable: the IV is random per
-- value, so two rows holding the same national ID have different ciphertexts. The fingerprint layer is
-- deliberately deferred; the name is sufficient here because the set is tiny (measured: 6 customers
-- hold any UBO at all, the largest set is 2) and entered deliberately by an officer rather than
-- imported.
--
-- The UBO register is also the single place in this system where a family's names are MOST likely to
-- recur, which is exactly why it uses `canonical_person_key` and not the sorted one.
DO $$
DECLARE
  dupes int;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT 1 FROM "UltimateBeneficialOwner"
    GROUP BY "customerId", canonical_person_key("fullName")
    HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'duplicate-prevention: % beneficial-owner name(s) appear more than once on the SAME customer. Report them; do not delete a row to make this index fit.',
      dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX "UltimateBeneficialOwner_one_person_per_customer"
  ON "UltimateBeneficialOwner" ("customerId", (canonical_person_key("fullName")));

-- ============================================================================================
-- 3. THE EMPLOYEE — unique on ACTIVE SERVICE ONLY
-- ============================================================================================
-- Partial on `terminationDate IS NULL`, so a person whose service ended may be rehired as a NEW ROW
-- with no block, while two simultaneously-active rows for one person are refused. Same technique as
-- the insurer unique above and as the live-commission-agreement indexes.
--
-- A KNOWN LIMIT, written down rather than discovered later: a rehired person's history is SPLIT ACROSS
-- TWO ROWS, so prior training records and licences sit on the old one. The cleaner model is one person
-- with service periods; that is a model change deliberately not opened here.
--
-- AND IT IS UNTESTED BY DATA: measured, there are ZERO terminated employee rows in either database, so
-- the rehire path this index exists for is exercised by nothing that already exists. Its evidence is
-- `employee-rehire.e2e-spec.ts`, written in the same change, which terminates an employee and rehires
-- them and proves the index permits the second row while refusing a second ACTIVE one.
DO $$
DECLARE
  dupes int;
  sample text;
BEGIN
  SELECT count(*), min(k) INTO dupes, sample FROM (
    SELECT canonical_person_key("fullName") AS k
    FROM "Employee"
    WHERE "terminationDate" IS NULL
    GROUP BY "organizationId", canonical_person_key("fullName")
    HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'duplicate-prevention: % name(s) are held by more than one ACTIVE employee in one office (e.g. "%"). On a seeded database this is a FIXTURE artifact — two generated employees that drew the same name from the pool — and the fix is in the generator, not in the data. REPORT the rows and let the office decide; never delete one to make this index fit.',
      dupes, sample;
  END IF;
END $$;

CREATE UNIQUE INDEX "Employee_one_active_person_per_office"
  ON "Employee" ("organizationId", (canonical_person_key("fullName")))
  WHERE "terminationDate" IS NULL;

-- ============================================================================================
-- 4. ASSERT WHAT WAS BUILT, because `db:divergence` cannot see any of it
-- ============================================================================================
-- Partial indexes and expression indexes are both invisible to that gate — a future migration could
-- drop any of these three and it would stay green. So the migration asserts its own work, which is the
-- house rule for anything the divergence check cannot reach.
DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
  n text;
BEGIN
  FOREACH n IN ARRAY ARRAY[
    'Customer_one_company_per_registration_number',
    'UltimateBeneficialOwner_one_person_per_customer',
    'Employee_one_active_person_per_office'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = n) THEN
      missing := missing || n;
    END IF;
  END LOOP;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'duplicate-prevention: index(es) % were not created', missing;
  END IF;

  -- And that the PERSON key really does preserve order, asserted on the two cousins rather than on the
  -- function's source text. A future edit that reintroduced a sort would satisfy a source check.
  IF canonical_person_key('إبراهيم رشيد سالم التميمي')
     = canonical_person_key('إبراهيم سالم رشيد التميمي') THEN
    RAISE EXCEPTION
      'duplicate-prevention: canonical_person_key is sorting its tokens — two cousins share a key, which is the exact defect this function exists to avoid';
  END IF;

  -- The company key must still SORT, or the insurer directory's grouping changes under it.
  IF canonical_name_key('Al-Yarmouk Insurance Company')
     <> canonical_name_key('Insurance Company Al-Yarmouk') THEN
    RAISE EXCEPTION
      'duplicate-prevention: canonical_name_key stopped folding word order, which the insurer directory depends on';
  END IF;
END $$;
