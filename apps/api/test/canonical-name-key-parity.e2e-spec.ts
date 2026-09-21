import { describe, expect, it } from 'vitest';
import { rawPrisma } from './tenant-prisma';
import { canonicalNameKey } from '../src/common/company-name.util';

/**
 * The SQL `canonical_name_key()` and the TypeScript `canonicalNameKey()` agree, on names
 * chosen to hit every folding rule.
 *
 * ## Why two implementations exist at all
 *
 * ONE of them is the authority: the SQL function, because it backs a GENERATED column that
 * the directory groups by and a unique index that decides whether an office has already
 * registered a company. The database decides, and the application cannot write the column.
 *
 * The TypeScript one survives for ONE job — telling somebody mid-registration "did you mean
 * …?" — which needs the key before a row exists to compute it from. That is a real need and
 * a real duplication, and IMPROVEMENTS.md § 1.23's rule applies: two implementations kept in
 * step by careful people is a comment that states an invariant wearing different clothes.
 *
 * So the agreement is a TEST, over a table of pairs. Divergence is a failing build rather
 * than a support ticket about a suggestion that did not appear.
 *
 * ## The two subtleties this caught while being written
 *
 * **Token ordering, and a limit of this test database.** JavaScript `.sort()` orders by
 * UTF-16 code unit; Postgres `ORDER BY` uses the database collation. The SQL function
 * therefore sorts `COLLATE "C"` — byte order, which equals code-point order in UTF-8, which
 * equals UTF-16 order for the Basic Multilingual Plane that Arabic and Latin both live in.
 *
 * That clause CANNOT BE TESTED BEHAVIOURALLY HERE, and pretending otherwise would be the
 * §1.20 mistake. Measured: this database is `en_US.utf8` on `postgres:18-alpine`, and Alpine
 * is musl, which ships no locale data — so the "dictionary" collation falls back to byte
 * order and is indistinguishable from `COLLATE "C"`. Removing the clause was planted and the
 * parity test stayed green, which is how this was found.
 *
 * On a glibc or ICU deployment (the debian-based image, or a managed Postgres) `en_US.utf8`
 * IS dictionary order: 'étoile' sorts next to 'etoile' rather than after 'zurich'. There, the
 * missing clause would silently produce different keys from the TypeScript function — for a
 * company name containing a Latin accent, which a European reinsurer's name plausibly does.
 * So the clause is asserted STRUCTURALLY below, since the behaviour it protects cannot be
 * exercised on this image.
 *
 * **Word characters, and the two more locale dependencies that are now GONE.** The function is
 * declared IMMUTABLE and a STORED generated column plus a unique index are built on that being
 * true, so every operation inside it was enumerated. Three were locale-dependent:
 *
 *  1. the token `ORDER BY` — fixed with `COLLATE "C"`, and structurally asserted below;
 *  2. `lower()` — Postgres marks it IMMUTABLE even though it is CTYPE-sensitive, a wart in
 *     Postgres itself that this function inherits;
 *  3. `[^[:alnum:][:space:]]` — POSIX classes are CTYPE-dependent.
 *
 * Measured on this database, which is the only honest way to describe it:
 *
 *     regexp_replace('تأمين', '[^[:alnum:][:space:]]', '*', 'g')                -> 'تأمين'
 *     regexp_replace('تأمين' COLLATE "C", '[^[:alnum:][:space:]]', '*', 'g')    -> '*****'
 *     lower('ÉTOILE')              -> 'étoile'
 *     lower('ÉTOILE' COLLATE "C")  -> 'Étoile'
 *
 * So under a `C` CTYPE every Arabic letter is treated as punctuation and replaced — which
 * makes the key of EVERY Arabic name the empty string. In an Arabic-primary system that is
 * not a rounding error: every Arabic-named local insurer in one office would collide on one
 * key, the unique index would refuse the second, and the directory would merge them all into
 * a single entry.
 *
 * **Both CTYPE dependencies were then REMOVED rather than documented** (migration
 * `20261014100000`). `lower()` became an enumerated `translate()` over ASCII and the Latin-1
 * capitals; the POSIX class became an explicit allowed set — Arabic U+0600..U+06FF, Latin
 * (ASCII + Latin-1), digits — with everything else, including `\s`, treated as a separator.
 * The TypeScript mirror was changed to the identical rule in the same commit, which is why
 * `foldCase` exists there instead of `toLowerCase()`.
 *
 * The SCOPE that buys: a name in Cyrillic, Greek or CJK folds to its digits and ASCII content
 * only. Deliberate for a system whose registration form demands a Latin AND an Arabic name,
 * and a limit that has to be widened on BOTH sides together — so do not add a name in a new
 * script to the table below expecting it to pass.
 *
 * What remains untestable here is ONE thing: the `COLLATE "C"` on the token sort, which is
 * about the STORED column's stability across library upgrades rather than about CTYPE. It is
 * still asserted structurally, and the reason is in the migration beside the clause.
 */

/** Every rule the folding applies, plus the cases that break naive implementations. */
const NAMES = [
  // Plain Latin, and case.
  'Motor Comprehensive',
  'MOTOR COMPREHENSIVE',
  'motor comprehensive',
  // Word order — the token sort.
  'Comprehensive Motor',
  'Yarmouk Al Insurance',
  // Punctuation and whitespace.
  'Al-Yarmouk Insurance',
  '  Al   Yarmouk   Insurance  ',
  'Motor (Comprehensive)',
  'Marine/Cargo',
  'Property All Risks (Fire)',
  // Arabic: alef variants.
  'أمان',
  'إمان',
  'آمان',
  'ٱمان',
  'امان',
  // Diacritics and tatweel.
  'تَأْمِين',
  'تـــأمين',
  'تأمين',
  // Teh marbuta and alef maqsura.
  'التعاونية',
  'التعاونيه',
  'الكبرى',
  'الكبري',
  // The definite article, and a short word that must NOT be eaten by the rule.
  'تأمين المركبات الشامل',
  'تأمين مركبات شامل',
  'الشامل المركبات تأمين',
  'الف',
  'ال',
  // Mixed scripts, digits, and a real-looking bilingual company name.
  'شركة اليرموك للتأمين 2026',
  'Al Yarmouk Insurance Co. (شركة اليرموك)',
  // Degenerate inputs.
  '',
  '   ',
  '--- ()',
  '123',
  // Latin accents. These discriminate byte order from dictionary order on a glibc/ICU
  // deployment and are indistinguishable here (see the header) — carried anyway, because the
  // test runs wherever the suite runs.
  'Zurich Étoile Assurance',
  'Générale Zurich',
  // Names that must stay DIFFERENT.
  'Marine Cargo',
  'Marine Hull',
  "Contractors' All Risks",
  'Erection All Risks',
  'سيارات شامل',

  // ---- Arabic NON-LETTERS inside the Arabic block (added 2026-10-15) ----------------------
  // The block U+0600..U+06FF is not a letter range, and allowing all of it meant ASCII
  // punctuation was stripped while Arabic punctuation was kept. Each pair below must key
  // IDENTICALLY; before `20261015100000` every one of them keyed differently.
  'شركة، التأمين', //          U+060C arabic comma
  'شركة؛ التأمين', //          U+061B arabic semicolon
  'شركة؟ التأمين', //          U+061F arabic question mark
  'شركة۔ التأمين', //          U+06D4 arabic full stop
  'شركة٬ التأمين', //          U+066C thousands separator
  'شركة التأمين', //           ... all five fold to this

  // Arabic-Indic digits, both ranges, fold to ASCII — same number, same key.
  'شركة ١٢٣', //               U+0660..U+0669
  'شركة ۱۲۳', //               U+06F0..U+06F9
  'شركة 123',

  // Presentation forms normalise to base letters rather than being stripped to fragments,
  // which is how a name pasted from an older PDF arrives.
  'ﺷﺮﻛﺔ',
  'شركة',

  // A combining mark is ERASED, not turned into a word-splitting separator.
  'شَركة التأمين',
];

describe('canonical_name_key: SQL and TypeScript agree', () => {
  it('produces the identical key for every name in the table', async () => {
    // One round trip for the whole table, so a failure lists every disagreement at once
    // rather than stopping at the first.
    const rows = await rawPrisma.$queryRaw<{ input: string; sql: string }[]>`
      SELECT n AS input, canonical_name_key(n) AS sql
      FROM unnest(${NAMES}::text[]) AS n
    `;
    expect(rows).toHaveLength(NAMES.length);

    const disagreements = rows
      .map((row) => ({
        input: row.input,
        sql: row.sql,
        ts: canonicalNameKey(row.input),
      }))
      .filter((r) => r.sql !== r.ts);

    expect(
      disagreements,
      'the SQL function backs a GENERATED column and a unique index; the TypeScript one only suggests. Where they disagree, the database is right and the suggestion is wrong — which is a suggestion that fails to appear, or appears for the wrong name',
    ).toEqual([]);
  }, 120_000);

  it('still folds what it is supposed to fold, in SQL', async () => {
    // The parity test above would pass if BOTH implementations were broken in the same way.
    // These are the properties themselves, asserted against the database.
    const [row] = await rawPrisma.$queryRaw<Record<string, boolean | string>[]>`
      SELECT
        canonical_name_key('Al-Yarmouk Insurance')
          = canonical_name_key('  al   yarmouk   insurance ') AS punctuation_and_space,
        canonical_name_key('تأمين المركبات الشامل')
          = canonical_name_key('تامين مركبات شامل') AS article_hamza_and_order,
        canonical_name_key('التعاونية') = canonical_name_key('التعاونيه') AS teh_marbuta,
        canonical_name_key('الكبرى') = canonical_name_key('الكبري') AS alef_maqsura,
        canonical_name_key('تـــأمين') = canonical_name_key('تأمين') AS tatweel,
        canonical_name_key('الف') AS short_word_kept,
        canonical_name_key('Marine Cargo') = canonical_name_key('Marine Hull')
          AS different_names_must_differ
    `;
    expect(row.punctuation_and_space).toBe(true);
    expect(row.article_hamza_and_order).toBe(true);
    expect(row.teh_marbuta).toBe(true);
    expect(row.alef_maqsura).toBe(true);
    expect(row.tatweel).toBe(true);
    // The article rule requires three more Arabic letters, so a short word survives whole.
    expect(row.short_word_kept).toBe('الف');
    expect(row.different_names_must_differ).toBe(false);
  }, 120_000);

  it('is CTYPE-FREE — the same key under a C collation, which is now provable HERE', async () => {
    // This REPLACED a test asserting the database's CTYPE folds non-ASCII, and the replacement
    // matters twice over.
    //
    // The old version asserted a PRECONDITION the function no longer has. Worse, keeping it
    // would have made the suite refuse a `C`-locale database that the function now handles
    // perfectly well — a test blocking a deployment for a reason that had been fixed.
    //
    // And this property could not be tested at all before. The old function used `lower()` and
    // `[^[:alnum:][:space:]]`, so collating the input changed the ANSWER: an Arabic name came
    // back with every letter replaced. Now every fold is over an enumerated character set or a
    // literal Unicode range, so the collation of the argument cannot reach any of them — and
    // that is checkable on this image rather than being a claim about production.
    const [row] = await rawPrisma.$queryRaw<Record<string, boolean>[]>`
      SELECT
        canonical_name_key('تأمين المركبات الشامل' COLLATE "C")
          = canonical_name_key('تأمين المركبات الشامل')  AS arabic_unaffected,
        canonical_name_key('Zurich Étoile' COLLATE "C")
          = canonical_name_key('Zurich Étoile')          AS latin_unaffected,
        canonical_name_key('MOTOR (Comprehensive)' COLLATE "C")
          = canonical_name_key('MOTOR (Comprehensive)')  AS punctuation_unaffected
    `;
    expect(
      row.arabic_unaffected,
      'the collation of the argument changed the key for an Arabic name — some step inside the function is still consulting a CTYPE, and under a C locale it would key every Arabic name to the empty string',
    ).toBe(true);
    expect(row.latin_unaffected).toBe(true);
    expect(row.punctuation_unaffected).toBe(true);
  }, 120_000);

  it('sorts tokens with an EXPLICIT collation, which this image cannot prove behaviourally', async () => {
    // A structural assertion, and the header says why it has to be: on musl there is no
    // locale data, so the default collation already equals byte order and removing the
    // clause changes nothing measurable here. It changes everything on a glibc or ICU
    // deployment, where the key would diverge from the suggestion for any name carrying a
    // Latin accent.
    //
    // Asserting the source text is weaker than asserting behaviour, and it is what is
    // available. Recorded as such rather than dressed up.
    const [fn] = await rawPrisma.$queryRaw<{ src: string }[]>`
      SELECT p.prosrc AS src
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'canonical_name_key'
    `;
    expect(
      fn.src,
      'the token sort must name its collation explicitly, or the generated key depends on the locale the database happens to have been created with — and this image cannot show you the difference',
    ).toContain('COLLATE "C"');
  }, 120_000);

  it('is IMMUTABLE and STRICT, which is what lets a generated column use it', async () => {
    // Not decoration: Postgres refuses a STORED generated column whose expression is not
    // immutable, so this property is load-bearing rather than a hint to the planner.
    const [fn] = await rawPrisma.$queryRaw<
      { volatility: string; strict: boolean }[]
    >`
      SELECT p.provolatile AS volatility, p.proisstrict AS strict
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'canonical_name_key'
    `;
    expect(fn.volatility).toBe('i');
    expect(fn.strict).toBe(true);
  }, 120_000);
});
