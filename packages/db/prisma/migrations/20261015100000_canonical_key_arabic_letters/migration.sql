-- `canonical_name_key` allows Arabic LETTERS, not the Arabic BLOCK.
--
-- ============================================================================
-- THE DEFECT, WHICH WAS LIVE AND IS THE ONE THIS FUNCTION EXISTS TO PREVENT
-- ============================================================================
--
-- The previous class was `[^a-z0-9ß-öø-þ؀-ۿ]` — everything outside it becomes a separator.
-- `؀-ۿ` is U+0600..U+06FF, the whole Arabic block, and that block is NOT letters. It carries
-- punctuation, digits and format controls alongside them. So the function stripped ASCII
-- punctuation and KEPT Arabic punctuation, in a system whose company names are mostly Arabic.
--
-- Measured on db-test before this migration, `folds to the same key?`:
--
--     U+060C ARABIC COMMA .............. f        U+06D4 ARABIC FULL STOP ......... f
--     U+061B ARABIC SEMICOLON .......... f        U+066C THOUSANDS SEPARATOR ...... f
--     U+061F ARABIC QUESTION MARK ...... f        U+0660..U+0669 ARABIC-INDIC ..... f
--                                                 U+06F0..U+06F9 EXTENDED ......... f
--
-- In the language this product is primarily used in:
--
--     "شركة، التأمين"  vs  "شركة التأمين"   ->  two different companies
--     "شركة ١٢٣"       vs  "شركة 123"       ->  two different companies
--
-- Two offices registering the same insurer, one of them with a comma, get two rows and one
-- directory entry — the exact F13 defect, surviving in the other script because the fix was
-- written by someone reading the Latin case.
--
-- ============================================================================
-- THE FOUR CHANGES
-- ============================================================================
--
-- 1. ARABIC LETTERS ARE ENUMERATED as subranges, so every non-letter in the block falls to the
--    strip like any other punctuation. The ranges, with their code points, since nobody should
--    have to render these glyphs to review them:
--
--       U+0620..U+063F   letters (kashmiri yeh, hamza, ... farsi yeh with three dots)
--       U+0641..U+064A   letters (feh .. yeh)          U+0640 tatweel is NOT a letter
--       U+066E..U+066F   dotless beh, dotless qaf      U+066A..U+066D are punctuation
--       U+0671..U+06D3   letters                       U+0670 is a mark, U+06D4 a full stop
--       U+06D5           ae                            U+06D6..U+06ED are marks
--       U+06EE..U+06EF   dal/reh with inverted v       U+06F0..U+06F9 are digits
--       U+06FA..U+06FF   letters
--
-- 2. ARABIC-INDIC DIGITS FOLD TO ASCII — both ranges, U+0660..U+0669 and U+06F0..U+06F9 — by
--    `translate()`, in the same family as the alef fold. Same number, same key.
--
-- 3. PRESENTATION FORMS ARE NORMALISED, not dropped. U+FB50..U+FDFF and U+FE70..U+FEFF are
--    outside any letter range, so a name pasted from an older PDF would have been stripped to
--    fragments — a plausible WRONG key rather than an error, which is the worst of the
--    available outcomes. `normalize(value, NFKC)` maps them to base letters and splits the
--    lam-alef ligatures. It is IMMUTABLE (`pg_proc.provolatile = 'i'`, checked) and Unicode
--    normalisation is locale-independent by definition, so the function stays CTYPE-free.
--    Verified that NFKC leaves alef-with-hamza COMPOSED, so change 4's fold still sees it.
--
-- 4. THE COMBINING-MARK STRIP IS WIDENED, and this one is a consequence of change 1 rather
--    than an independent fix. Marks used to sit inside the allowed block and survive; now they
--    would fall to the strip and become a SPACE, which SPLITS A WORD IN HALF — worse than
--    keeping them. So every Arabic combining mark is deleted before the strip runs:
--    U+064B..U+065F, U+0670, U+06D6..U+06ED, plus U+0640 tatweel.
--
-- ============================================================================
-- WHY LATIN ACCENTS ARE STILL NOT FOLDED, WHILE ARABIC DIACRITICS ARE
-- ============================================================================
--
-- These are opposite policies in one function and that needs a stated reason, or the next
-- reader will "fix" the inconsistency in whichever direction they noticed first.
--
--   * ARABIC diacritics are ERASED. They are optional vowel marks. The same company writes
--     its own name with and without them, and readers treat the two as identical text. A
--     distinction that the writer does not intend cannot identify a company.
--
--   * LATIN accents are PRESERVED, and only case is folded. An accent in a Latin company name
--     is part of the spelling, not an optional aid: "Société" is how that company writes its
--     name and "Societe" may be a different company, or the same one transliterated — a broker
--     must be able to hold both and decide. Merging them is unrecoverable; keeping them apart
--     leaves the similarity layer free to suggest a match later.
--
-- The rule underneath, which is why this is not arbitrary: ERASE A DISTINCTION THE WRITER DID
-- NOT INTEND, PRESERVE ONE THEY DID. Case is not intended (a name in capitals on a form is the
-- same name). Arabic vowel marks are not intended. A Latin accent is.

-- ---------------------------------------------------------------------------
-- The new definition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION canonical_name_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $fn$
  SELECT coalesce(
    array_to_string(
      ARRAY(
        SELECT stripped
        FROM (
          -- The Arabic definite article, but only where three more Arabic LETTERS follow, so a
          -- genuinely short word is not beheaded. Letters, not the block: "ال" before a comma
          -- is not an article.
          SELECT regexp_replace(tok, '^ال(?=[ؠ-ؿف-يٮ-ٯٱ-ۓەۮ-ۯۺ-ۿ]{3,})', '') AS stripped
          FROM regexp_split_to_table(
                 -- Anything outside the enumerated sets becomes a separator. ARABIC LETTERS,
                 -- not the Arabic block: the block's punctuation and digits must fall here.
                 regexp_replace(
                   -- Alef variants -> ا, alef maqsura -> ي, teh marbuta -> ه.
                   translate(
                     -- Arabic-Indic digits -> ASCII, both ranges. Same number, same key.
                     translate(
                       -- Every Arabic combining mark, plus tatweel. Deleted rather than left to
                       -- the strip below, which would turn each one into a word-splitting space.
                       regexp_replace(
                         -- Case folded by ENUMERATION, not `lower()`, which is CTYPE-sensitive.
                         translate(
                           -- Presentation forms -> base letters; ligatures split. IMMUTABLE and
                           -- locale-independent, so this does not reintroduce a CTYPE dependency.
                           normalize(value, NFKC),
                           'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ',
                           'abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþ'
                         ),
                         '[ً-ٰٟۖ-ۭـ]', '', 'g'
                       ),
                       '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
                       '01234567890123456789'
                     ),
                     'آأإٱىة',
                     'اااايه'
                   ),
                   '[^a-z0-9ß-öø-þؠ-ؿف-يٮ-ٯٱ-ۓەۮ-ۯۺ-ۿ]', ' ', 'g'
                 ),
                 -- A literal space run, not `\s+`: `\s` is `[[:space:]]`, CTYPE-dependent.
                 ' +'
               ) AS tok
          WHERE tok <> ''
        ) t
        WHERE stripped <> ''
        -- ## COLLATE "C" IS LOAD-BEARING. DO NOT SIMPLIFY IT AWAY.
        --
        -- `canonicalName` is STORED. A value computed under one collation and one computed
        -- under another are DIFFERENT VALUES IN THE SAME COLUMN, and the unique index over it
        -- is then inconsistent with itself — the classic shape of index corruption after a
        -- glibc upgrade. `COLLATE "C"` is byte order, which no library upgrade changes.
        --
        -- It provably does nothing on a musl image, where the default collation is ALREADY
        -- byte order, which is exactly what makes it the clause a future reader deletes as
        -- noise. It buys its guarantee on the production database, where no test can see it.
        ORDER BY stripped COLLATE "C"
      ),
      ' '
    ),
    ''
  )
$fn$;

COMMENT ON FUNCTION canonical_name_key(text) IS
  'The single definition of "are these two names the same name". Backs the GENERATED column Insurer.canonicalName, the insurer directory''s GROUP BY, and the per-office uniqueness of a locally registered company. CTYPE-free by construction: every fold is over an enumerated character set, a literal Unicode range, or NFKC normalisation, so no locale is consulted. Knows Arabic LETTERS (not the whole Arabic block — its punctuation and digits are separators and folds respectively), Latin (ASCII + Latin-1) and digits; every other script is a separator. Erases distinctions the writer did not intend (case, Arabic vowel marks, presentation forms, digit script) and preserves ones they did (Latin accents). Mirrored in TypeScript for registration suggestions only, pinned by canonical-name-key-parity.e2e-spec.ts.';

-- ---------------------------------------------------------------------------
-- (a) REFUSE BEFORE RECOMPUTING, naming the companies that would collide.
--
-- Placed AFTER the replacement above and BEFORE the UPDATE below, deliberately: `CREATE OR
-- REPLACE FUNCTION` leaves every STORED value untouched, so `canonical_name_key(legalName)`
-- here computes with the NEW definition while the column still holds the OLD keys. That is
-- what lets the check run without a second copy of the function body. A RAISE rolls the whole
-- migration back, replacement included, because Prisma runs each file in one transaction.
-- ---------------------------------------------------------------------------
-- A folding change can merge two names that were distinct. Once the column is recomputed the
-- unique index refuses the write, and what the operator sees is a constraint violation halfway
-- through a migration naming an index. This asks the question BEFORE anything is written, and
-- answers it with the two company names in a sentence.
--
-- Mandatory for EVERY future migration touching this function: (a) pre-check, (b) force the
-- recompute, (c) verify no key became empty.
DO $precheck$
DECLARE
  collisions text;
BEGIN
  SELECT string_agg(detail, E'\n  ') INTO collisions
  FROM (
    SELECT format('office %s: %s', "organizationId", string_agg(quote_literal("legalName"), ' = ')) AS detail
    FROM "Insurer"
    WHERE "insurerMasterId" IS NULL AND "legalName" IS NOT NULL
    GROUP BY "organizationId", canonical_name_key("legalName")
    HAVING count(*) > 1
  ) g;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION E'The new canonical key merges names that are currently distinct, and the per-office unique index would refuse them:\n  %\n\nDecide which row survives and merge them BEFORE applying this migration. Nothing has been changed.', collisions;
  END IF;
END
$precheck$;

-- ---------------------------------------------------------------------------
-- (b) FORCE THE RECOMPUTE. `CREATE OR REPLACE FUNCTION` does not do it.
-- ---------------------------------------------------------------------------
-- Without this the column silently holds keys from the OLD definition while new rows get the
-- new one — two definitions in one column, which is the defect this line of work exists to
-- remove. A stale key is a wrong uniqueness decision and a wrong directory grouping, with no
-- error anywhere.
UPDATE "Insurer" SET "legalName" = "legalName" WHERE "legalName" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- (c) VERIFY, on the database being deployed to.
-- ---------------------------------------------------------------------------
-- No test of ours runs on the production database, so the assertions live here. Each one is a
-- property of the fix rather than a spot value, and the literal character ranges above are
-- exactly the thing a reviewer cannot eyeball — so they are asserted by BEHAVIOUR at the
-- boundaries rather than trusted as glyphs.
DO $assert$
DECLARE
  base       text := canonical_name_key('شركة التأمين');
  mark       text;
  cp         int;
BEGIN
  -- No key may be empty. An empty key collides with every other empty key.
  IF EXISTS (
    SELECT 1 FROM "Insurer"
    WHERE "insurerMasterId" IS NULL AND ("canonicalName" IS NULL OR "canonicalName" = '')
  ) THEN
    RAISE EXCEPTION 'Recomputing canonicalName produced an EMPTY key for at least one locally registered insurer. Every such row collides with every other on one key. Refusing to deploy.';
  END IF;

  -- Arabic PUNCTUATION must fall to the strip, one code point at a time:
  --   U+060C comma, U+061B semicolon, U+061F question mark, U+066A percent,
  --   U+066B decimal separator, U+066C thousands separator, U+066D five-pointed star,
  --   U+06D4 full stop.
  -- NOT U+066E/U+066F — those are dotless beh and dotless qaf, which are LETTERS. Listing
  -- them here is the mistake this assertion caught on its first run.
  FOREACH cp IN ARRAY ARRAY[1548, 1563, 1567, 1642, 1643, 1644, 1645, 1748] LOOP
    IF canonical_name_key('شركة' || chr(cp) || ' التأمين') <> base THEN
      RAISE EXCEPTION 'U+% is still treated as a letter: a name containing it keys differently from the same name without it. The Arabic letter ranges are wrong.', to_hex(cp);
    END IF;
  END LOOP;

  -- Arabic LETTERS at the range boundaries must SURVIVE. If a boundary is off by one, a real
  -- letter becomes a separator and every name containing it keys wrongly.
  FOREACH cp IN ARRAY ARRAY[1568, 1569, 1599, 1601, 1610, 1646, 1647, 1649, 1747, 1749, 1774, 1775, 1786, 1791] LOOP
    IF canonical_name_key(chr(cp)) = '' THEN
      RAISE EXCEPTION 'U+% is an Arabic letter but keys to the empty string — it is outside the enumerated ranges.', to_hex(cp);
    END IF;
  END LOOP;

  -- Both Arabic-Indic digit ranges fold to ASCII.
  IF canonical_name_key('شركة ' || chr(1633) || chr(1634) || chr(1635)) <> canonical_name_key('شركة 123') THEN
    RAISE EXCEPTION 'U+0660..U+0669 Arabic-Indic digits do not fold to ASCII: the same number written in two scripts keys differently.';
  END IF;
  IF canonical_name_key('شركة ' || chr(1777) || chr(1778) || chr(1779)) <> canonical_name_key('شركة 123') THEN
    RAISE EXCEPTION 'U+06F0..U+06F9 extended Arabic-Indic digits do not fold to ASCII.';
  END IF;

  -- Presentation forms normalise to base letters rather than being stripped to fragments.
  -- U+FEB7 sheen-initial, U+FEAE reh-final, U+FEDB kaf-initial, U+FE94 teh-marbuta-final —
  -- i.e. the same company name as it arrives pasted from an older PDF. Each verified to
  -- normalise to its base letter (U+0634, U+0631, U+0643, U+0629) before being used here;
  -- the first version of this assertion used U+FEF3, which is a YEH, and failed correctly.
  IF canonical_name_key(chr(65207) || chr(65198) || chr(65243) || chr(65172)) <> canonical_name_key('شركة') THEN
    RAISE EXCEPTION 'Arabic presentation forms (U+FB50..U+FEFF) do not normalise to base letters — a name pasted from an older document would key to something plausible and wrong.';
  END IF;

  -- A combining mark must be DELETED, not turned into a word-splitting space.
  mark := canonical_name_key('شركة' || chr(1614) || ' التأمين');
  IF mark <> base THEN
    RAISE EXCEPTION 'An Arabic combining mark changed the key (got "%", expected "%") — it is being treated as a separator and splitting the word rather than being erased.', mark, base;
  END IF;

  -- The CTYPE-freedom property from 20261014100000 still holds.
  IF canonical_name_key('تأمين المركبات الشامل' COLLATE "C") <> canonical_name_key('تأمين المركبات الشامل') THEN
    RAISE EXCEPTION 'canonical_name_key is no longer CTYPE-free — a C-locale database would key Arabic names differently. Refusing to deploy.';
  END IF;

  -- Latin accents are PRESERVED and only case folded, which is the deliberate opposite of the
  -- Arabic diacritic rule. Asserted so the inconsistency cannot be "tidied" without a failure.
  IF canonical_name_key('ÉTOILE') <> 'étoile' THEN
    RAISE EXCEPTION 'canonical_name_key(''ÉTOILE'') returned "%" rather than "étoile" — either the Latin-1 case fold is broken or accents are being stripped, which would merge two companies a broker must be able to keep apart.', canonical_name_key('ÉTOILE');
  END IF;

  -- Word order still folds, and the token sort is still byte-ordered.
  IF canonical_name_key('Zurich Assurance') <> 'assurance zurich' THEN
    RAISE EXCEPTION 'The token sort is not byte-ordered — stored keys on this database will not match keys computed anywhere else.';
  END IF;
END
$assert$;
