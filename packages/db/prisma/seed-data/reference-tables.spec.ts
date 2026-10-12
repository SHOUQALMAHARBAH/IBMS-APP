import { describe, expect, it } from "vitest";
import {
  BANKS,
  BUSINESS_MODELS,
  CITIES,
  COUNTRIES,
  CURRENCIES,
  LEGAL_FORMS,
  LICENSING_AUTHORITIES,
  RATING_AGENCIES,
  type ReferenceSeed,
} from "./reference-tables";

/**
 * MODULE 0-ب ITEM (c) — the properties the eight reference lists must hold.
 *
 * These are seed lists, not code, so nothing else would notice them going wrong. Every assertion
 * here is about a failure that is SILENT in production: a row with no Arabic prints untranslated
 * on an Arabic-first screen; a duplicate code makes the seed's upsert overwrite a different row on
 * every run; a placeholder row teaches an administrator that the list is decorative.
 */

const LISTS: [string, ReferenceSeed[]][] = [
  ["COUNTRIES", COUNTRIES],
  ["CITIES", CITIES],
  ["BANKS", BANKS],
  ["CURRENCIES", CURRENCIES],
  ["LICENSING_AUTHORITIES", LICENSING_AUTHORITIES],
  ["RATING_AGENCIES", RATING_AGENCIES],
  ["LEGAL_FORMS", LEGAL_FORMS],
  ["BUSINESS_MODELS", BUSINESS_MODELS],
];

/** Arabic letters. Used to prove `nameAr` is actually Arabic rather than the English string
 *  copied across, which is the way a bilingual field fails without anybody noticing. */
const ARABIC = /[؀-ۿ]/;

describe("the eight provider-maintained reference lists", () => {
  it("is EIGHT lists, and none of them is empty", () => {
    // Non-vacuity first: every per-list assertion below passes trivially on an empty array, and a
    // list that silently became empty would reach an administrator as a picker with no options.
    expect(LISTS).toHaveLength(8);
    for (const [name, rows] of LISTS) {
      expect(rows.length, `${name} is empty`).toBeGreaterThan(0);
    }
  });

  describe.each(LISTS)("%s", (name, rows) => {
    it("gives every row BOTH scripts, and the Arabic is really Arabic", () => {
      for (const row of rows) {
        expect(row.nameEn.trim(), `${name}.${row.code} nameEn`).not.toBe("");
        expect(row.nameAr.trim(), `${name}.${row.code} nameAr`).not.toBe("");
        // The half a parity count cannot catch. `nameAr: "Arab Bank"` is present, non-empty, and
        // wrong — and on an Arabic-first platform it reaches a reader as untranslated text.
        expect(
          ARABIC.test(row.nameAr),
          `${name}.${row.code} nameAr is not Arabic script: ${row.nameAr}`,
        ).toBe(true);
      }
    });

    it("has unique codes — the seed upserts on them", () => {
      /*
       * `seed.ts` upserts `where: { code }`. A duplicated code does NOT fail: the second row
       * overwrites the first, every run, and the catalogue silently loses an entry while the seed
       * reports success. The database's unique index cannot catch it either — both writes target
       * the same key by design.
       */
      const codes = rows.map((r) => r.code);
      expect(new Set(codes).size, `${name} has duplicate codes`).toBe(
        codes.length,
      );
    });

    it("uses SCREAMING_SNAKE codes, so a code never reads as a label", () => {
      for (const row of rows) {
        expect(row.code, `${name}.${row.code}`).toMatch(/^[A-Z0-9_]+$/);
      }
    });

    it("contains NO placeholder row", () => {
      /*
       * The owner's instruction: "a seed row that is a placeholder is worse than a short list".
       *
       * A placeholder is worse because it is always available and always wrong — an administrator
       * who cannot find their bank picks OTHER, and the office's record then says nothing. A short
       * list produces a question instead, and these are TABLES precisely so the answer is a row.
       */
      const FORBIDDEN = ["OTHER", "UNKNOWN", "TBD", "NA", "N_A", "MISC", "NONE"];
      for (const row of rows) {
        expect(
          FORBIDDEN,
          `${name} carries the placeholder row ${row.code}`,
        ).not.toContain(row.code);
      }
    });
  });

  it("keeps the legal form art. 10/a/1/a needs, which the field sheet does not list", () => {
    /*
     * The one row below that the owner's source document does not contain, and it is load-bearing:
     * art. 10/a/1/a requires a NATURAL_PERSON broker to be registered as a sole establishment, and
     * `BrokerKind` has exactly two values. Without this row half the broker kinds this system
     * models would be unregisterable — a precondition nothing can satisfy, which this project has
     * shipped once already.
     */
    expect(LEGAL_FORMS.map((f) => f.code)).toContain("SOLE_ESTABLISHMENT");
  });

  it("keeps JOD, because every money column in this schema assumes it", () => {
    // `Decimal(18,3)` throughout exists because the dinar divides into 1000 fils. A currency list
    // without JOD would be a list that cannot express the base currency of the system.
    expect(CURRENCIES.map((c) => c.code)).toContain("JOD");
  });
});
