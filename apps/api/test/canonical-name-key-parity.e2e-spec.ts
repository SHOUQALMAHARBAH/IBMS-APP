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
 * **Word characters.** `[^\p{L}\p{N}\s]` in JavaScript against `[^[:alnum:][:space:]]` in
 * Postgres. Those are different notations for the same intent, and whether the POSIX class
 * covers Arabic depends on the database's collation — which is exactly why this is measured
 * against a live database rather than reasoned about from the documentation.
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
