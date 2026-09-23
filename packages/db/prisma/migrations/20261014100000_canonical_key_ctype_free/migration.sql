-- `canonical_name_key` becomes CTYPE-FREE BY CONSTRUCTION, and asserts itself on deploy.
--
-- ============================================================================
-- WHY THIS IS NOT TIDYING
-- ============================================================================
--
-- The previous version contained two operations whose behaviour was decided by the
-- database's locale rather than by us, and they failed in OPPOSITE directions:
--
--   * `ORDER BY stripped COLLATE "C"` REQUIRES byte ordering to be correct — a stored key
--     computed under a dictionary collation and one computed under byte order are different
--     values in the same column, and the unique index over them is inconsistent with itself.
--   * `lower()` and `[^[:alnum:][:space:]]` are DESTROYED by a C ctype. Measured:
--     `regexp_replace('تأمين' COLLATE "C", '[^[:alnum:][:space:]]', '*', 'g')` -> '*****'.
--     Every Arabic letter becomes punctuation, so every Arabic name keys to the EMPTY
--     STRING.
--
-- Those two sat in the same function, and that coexistence was the real defect. The first
-- person to "make it consistent" — adding `COLLATE "C"` at the top, or creating the database
-- with `LC_CTYPE=C` for reproducibility, both entirely reasonable-sounding — wipes every
-- Arabic name in the system. In an Arabic-primary product that means an office can register
-- exactly ONE local insurer ever, the second is refused as a duplicate of a company it is
-- not, and the directory shows every Arabic-named insurer as one entry. Their change would
-- look like cleanup.
--
-- So the dependency is removed rather than documented. Every step now folds over an
-- ENUMERATED character set or a literal Unicode range; no CTYPE and no collation is consulted
-- anywhere, and `IMMUTABLE` is true by construction rather than by declaration.
--
-- ============================================================================
-- THE SCOPE OF THE KEY, DECIDED EXPLICITLY RATHER THAN INHERITED
-- ============================================================================
--
-- A key built from enumerated sets has to say which characters it knows about. This one
-- knows:
--
--   * ARABIC — the whole U+0600..U+06FF block;
--   * LATIN — ASCII letters, plus the Latin-1 letters (ß à-ö ø-þ and their capitals), because
--     a European reinsurer's name plausibly carries one: Zürich, Münchener, Société;
--   * DIGITS — 0-9.
--
-- Everything else — including Cyrillic, Greek and CJK — is a SEPARATOR, exactly as punctuation
-- is. That is a deliberate limit for a Jordanian brokerage system whose registration form
-- demands both a Latin and an Arabic name, not an oversight; and the TypeScript mirror was
-- changed to the identical rule in the same commit, so parity still holds. Widening the scope
-- means widening both, and adding a name in a new script to the parity table.
--
-- Case folding is enumerated for the same reason: `A-Z` and the Latin-1 capitals, mapped
-- character for character. Arabic is caseless, so nothing is lost there.

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
          -- The Arabic definite article, but only where three more Arabic letters follow, so
          -- a genuinely short word is not beheaded. A literal Unicode range.
          SELECT regexp_replace(tok, '^ال(?=[؀-ۿ]{3,})', '') AS stripped
          FROM regexp_split_to_table(
                 -- Anything outside the enumerated sets becomes a separator. No POSIX class,
                 -- so no CTYPE: `[[:alnum:]]` is what a C locale turns into "ASCII only", and
                 -- with it every Arabic letter into punctuation.
                 regexp_replace(
                   -- Alef variants -> ا, alef maqsura -> ي, teh marbuta -> ه.
                   translate(
                     -- Diacritics and tatweel carry no meaning in a name.
                     regexp_replace(
                       -- Case folded by ENUMERATION, not by `lower()`, which is
                       -- CTYPE-sensitive and which Postgres marks IMMUTABLE anyway.
                       translate(
                         value,
                         'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ',
                         'abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþ'
                       ),
                       '[ً-ْٰـ]', '', 'g'
                     ),
                     'آأإٱىة',
                     'اااايه'
                   ),
                   '[^a-z0-9ß-öø-þ؀-ۿ]', ' ', 'g'
                 ),
                 -- A literal space run, not `\s+`: `\s` is `[[:space:]]`, which is another
                 -- CTYPE-dependent class. Nothing else survives the strip above as
                 -- whitespace, because a tab or a newline is outside the enumerated sets and
                 -- has already become a space.
                 ' +'
               ) AS tok
          WHERE tok <> ''
        ) t
        WHERE stripped <> ''
        -- ## COLLATE "C" IS LOAD-BEARING. DO NOT SIMPLIFY IT AWAY.
        --
        -- `canonicalName` is STORED. A value computed under one collation and a value
        -- computed under another are DIFFERENT VALUES IN THE SAME COLUMN, and the unique
        -- index over it would then be inconsistent with itself — the classic shape of index
        -- corruption after a glibc upgrade, existing entries ordered one way and new ones
        -- another. `COLLATE "C"` is byte order, which no library upgrade changes.
        --
        -- It provably does nothing on a musl image, where the default collation is ALREADY
        -- byte order — planted and observed: parity stayed green. That is exactly what makes
        -- it the clause a future reader deletes as noise. It buys its guarantee on the
        -- production database, where no test of ours can see it.
        ORDER BY stripped COLLATE "C"
      ),
      ' '
    ),
    ''
  )
$fn$;

COMMENT ON FUNCTION canonical_name_key(text) IS
  'The single definition of "are these two names the same name". Backs the GENERATED column Insurer.canonicalName, the insurer directory''s GROUP BY, and the per-office uniqueness of a locally registered company. CTYPE-free by construction: every fold is over an enumerated character set or a literal Unicode range, so no locale is consulted. Knows Arabic (U+0600..U+06FF), Latin (ASCII + Latin-1) and digits; every other script is a separator. Mirrored in TypeScript for registration suggestions only, pinned by canonical-name-key-parity.e2e-spec.ts.';

-- ---------------------------------------------------------------------------
-- The stored column must be RECOMPUTED. Replacing the function does not do it.
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE FUNCTION` leaves every existing STORED generated value untouched, so the
-- column would silently hold keys from the old definition while new rows got the new one —
-- two definitions in one column, which is the defect this whole line of work exists to
-- remove. A no-op UPDATE rewrites each row and recomputes the column.
--
-- Safe to do in one statement here: `Insurer` holds thousands of rows, not millions, and the
-- values are in practice identical (the folds differ only for characters no existing name
-- contains). Verified after the fact by the zero-collision check the unique index would
-- otherwise refuse.
UPDATE "Insurer" SET "legalName" = "legalName" WHERE "legalName" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The assertion, where it will actually run.
-- ---------------------------------------------------------------------------
-- The suite's version of this check runs on alpine, where it passes trivially — the database
-- where the property matters is the one nobody has created yet, and no test of ours will ever
-- run against it. So the assertion lives in the migration: it executes on whatever database is
-- deployed to, at the moment the schema lands, before a single row exists.
--
-- A deploy that would have broken every Arabic name fails to deploy.
DO $assert$
DECLARE
  arabic_key text := canonical_name_key('تأمين المركبات الشامل');
  -- Accents are PRESERVED and only the case is folded: É -> é, and é is a letter in the
  -- enumerated set. The alternative rule (É -> e, stripping the accent) was considered and
  -- rejected — "Zürich" and "Zurich" are plausibly two different companies to a broker, and a
  -- key that conflated them would merge two directory entries that should stay apart.
  --
  -- This assertion is why that decision is written down rather than assumed: its FIRST version
  -- expected 'etoile', the function returned 'étoile', and the migration refused to deploy. The
  -- rule had been decided two different ways in one commit, and the deploy-time check is what
  -- said so — on its author, within a minute of being written.
  folded_key text := canonical_name_key('ÉTOILE');
  order_key  text := canonical_name_key('Zurich Assurance');
BEGIN
  IF arabic_key IS NULL OR arabic_key = '' THEN
    RAISE EXCEPTION
      'canonical_name_key() returns an EMPTY key for an Arabic name on this database. Every Arabic-named insurer would collide on one key: an office could register exactly one, the second would be refused as a duplicate of a company it is not, and the directory would merge them all into a single entry. This is what a C ctype does to the function. Refusing to deploy.';
  END IF;
  IF folded_key <> 'étoile' THEN
    RAISE EXCEPTION
      'canonical_name_key(''ÉTOILE'') returned "%" rather than "étoile" — the enumerated case fold is not covering the Latin-1 capitals, or the accented letter is not in the allowed set, so an accented company name keys differently here than in the TypeScript mirror. Refusing to deploy.', folded_key;
  END IF;
  IF order_key <> 'assurance zurich' THEN
    RAISE EXCEPTION
      'canonical_name_key(''Zurich Assurance'') returned "%" rather than "assurance zurich" — the token sort is not byte-ordered, so stored keys on this database will not match keys computed anywhere else. Refusing to deploy.', order_key;
  END IF;
END
$assert$;
