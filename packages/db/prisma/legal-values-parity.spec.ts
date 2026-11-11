import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LEGAL_VALUES,
  OFFICE_SUPPLIED_LEGAL_VALUES,
  PROVIDER_LEGAL_VALUES,
} from "./seed-data/legal-values";

/*
 * THE LEGAL-VALUE CODES ARE DECLARED TWICE, AND THEY MUST NOT DRIFT.
 *
 * `packages/db/prisma/seed-data/legal-values.ts` is the SOURCE: it carries every figure, its
 * article, the printed page it was read on, and who owns the row. `db:seed` writes the
 * provider-owned ones into `LegalValue`.
 *
 * `apps/api/src/modules/compliance-risk/legal-figures.config.ts` names the subset the LICENCE
 * rules read, as `LICENCE_LEGAL_VALUE_CODES`. It has to be a second declaration: `apps/api` cannot
 * import from `packages/db/prisma/seed-data` — `@ibms/db` exports only `.` and `./password-policy`,
 * and a relative import out of `apps/api` into `packages/` is the recorded failure that broke the
 * DOCKER BUILD once, because `turbo prune` keeps a different tree than local gates see.
 *
 * So the api names codes as STRINGS and this file is what stops a typo in either place becoming a
 * runtime refusal nobody can explain. It reads the api file as TEXT, which is the same shape
 * `permission-catalogue-parity.spec.ts` uses and for the same reason.
 *
 * ## WHAT GOES WRONG WITHOUT IT, concretely
 *
 * `licenceFiguresFrom` THROWS, naming the code, when a figure it asks for has no row — which is
 * correct behaviour (a missing legal figure must never default). A renamed code in either file
 * therefore turns every licence answer in the product into a 422 that reads like a seeding fault.
 * This file turns that into a failing unit test instead.
 */

const API_FIGURES = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "apps",
  "api",
  "src",
  "modules",
  "compliance-risk",
  "legal-figures.config.ts",
);

function apiCodes(): string[] {
  const text = fs.readFileSync(API_FIGURES, "utf8");
  const block = /export const LICENCE_LEGAL_VALUE_CODES = \{([\s\S]*?)\n\} as const;/.exec(
    text,
  );
  if (!block) {
    throw new Error(
      "LICENCE_LEGAL_VALUE_CODES was not found in legal-figures.config.ts — this guard is now " +
        "BLIND. Re-point it; do not delete it.",
    );
  }
  return [...block[1].matchAll(/:\s*'([A-Z0-9_]+)'/g)].map((m) => m[1]);
}

describe("legal values — the catalogue and the api's code names agree", () => {
  it("finds the api's declaration at all (non-vacuity)", () => {
    // Without this, a renamed constant would make `apiCodes()` throw... and a later edit that
    // softened the throw to `[]` would make every assertion below vacuously true.
    expect(apiCodes().length).toBeGreaterThanOrEqual(7);
  });

  it("every code the licence rules read exists in the catalogue", () => {
    const known = new Set(LEGAL_VALUES.map((v) => v.code));
    for (const code of apiCodes()) {
      expect(known, `the api reads "${code}", which no catalogue entry defines`).toContain(
        code,
      );
    }
  });

  it("every code the licence rules read is PROVIDER-owned, so a row is actually seeded", () => {
    // An OFFICE-owned code ships with NO value (criterion 6 — dormant), so a licence rule reading
    // one would refuse on every office that has not declared it. That is a design error, not a
    // data state, and it belongs in a test rather than in a 422.
    const providerCodes = new Set(PROVIDER_LEGAL_VALUES.map((v) => v.code));
    for (const code of apiCodes()) {
      expect(
        providerCodes,
        `the licence rules read "${code}", but the catalogue marks it OFFICE-supplied — an ` +
          `office that has not declared it would get a refusal on every licence question`,
      ).toContain(code);
    }
  });
});

describe("legal values — the catalogue's own invariants", () => {
  it("has no duplicate codes", () => {
    const codes = LEGAL_VALUES.map((v) => v.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every PROVIDER entry states a figure and cites instrument, article and printed page", () => {
    // Mirrors the two CHECK constraints, so the failure is a unit test rather than a seeding
    // crash. The printed page is not decoration: our OCR extraction of this instrument publishes
    // two wrong figures marked «موثوق», so a citation without a page cannot be checked.
    for (const v of PROVIDER_LEGAL_VALUES) {
      expect(v.value, `${v.code} has no value`).not.toBeNull();
      expect(v.instrument, `${v.code} has no instrument`).toBeTruthy();
      expect(v.article, `${v.code} has no article`).toBeTruthy();
      expect(
        typeof v.printedPage,
        `${v.code} has no printed page — the page it was READ on is what makes the citation checkable`,
      ).toBe("number");
    }
  });

  it("every OFFICE entry ships with NO value — criterion 6, dormant", () => {
    // The Central Bank has issued none of the three. A seeded figure here would be this system
    // asserting a legal value nobody has stated, which OWNER DECISION 123 forbids outright.
    for (const v of OFFICE_SUPPLIED_LEGAL_VALUES) {
      expect(v.value, `${v.code} ships a value; the office supplies it, not us`).toBeNull();
      expect(v.printedPage, `${v.code} cites a page for a figure we do not have`).toBeNull();
    }
  });

  it("the three codes the Central Bank has not issued are exactly the ones named", () => {
    // Named rather than counted: a fourth deferred code appearing is a decision about whose row it
    // is, and a count would absorb it silently.
    expect(OFFICE_SUPPLIED_LEGAL_VALUES.map((v) => v.code).sort()).toEqual([
      "COMMISSION_BASIS_AND_CEILING",
      "DEFINED_BENEFIT_CONTRACT_LIST",
      "PROFESSIONAL_INDEMNITY_CONDITIONS",
    ]);
  });

  it("art. 4/a's five figures are present and its two boundaries are ordered", () => {
    const by = (code: string) => LEGAL_VALUES.find((v) => v.code === code);
    const first = by("CAPITAL_MAX_BRANCHES_BAND_1");
    const second = by("CAPITAL_MAX_BRANCHES_BAND_2");
    expect(first?.value).toBe("6");
    expect(second?.value).toBe("12");
    expect(by("CAPITAL_MIN_JOD_BAND_1")?.value).toBe("5000");
    expect(by("CAPITAL_MIN_JOD_BAND_2")?.value).toBe("7500");
    expect(by("CAPITAL_MIN_JOD_BAND_3")?.value).toBe("10000");
  });

  it("the api's TEST DOUBLE carries the same figures as the catalogue", () => {
    /*
     * `legal-figures.double.ts` holds art. 4/a's five figures, art. 11's 45 days and art. 14/c's two
     * years as literals, so six specs can assert licence behaviour against the instrument's own law
     * without each restating it. `check:legal-numbers` declares it in `SEEDS_THE_TABLE` — the
     * table's own source rather than a figure awaiting the table — and that declaration is only
     * honest if something keeps the double equal to the rows.
     *
     * This is that something. Without it, a figure that moved in the catalogue (and therefore in a
     * migration, and therefore in the database) would leave six api specs GREEN against the old
     * law — the worst shape a test suite can take, because it reports success about a rule the
     * product no longer follows.
     *
     * Read as TEXT, for the recorded reason: `apps/api` cannot be imported from here and a relative
     * import out of it into `packages/` broke the Docker build once.
     */
    const doubleText = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "apps",
        "api",
        "src",
        "modules",
        "compliance-risk",
        "legal-figures.double.ts",
      ),
      "utf8",
    );
    const block = /export const INSTRUMENT_LICENCE_FIGURES[\s\S]*?\n};/.exec(doubleText);
    expect(
      block,
      "INSTRUMENT_LICENCE_FIGURES was not found — this guard is now BLIND. Re-point it; do not delete it.",
    ).not.toBeNull();

    const mustAppear: [string, string][] = [
      ["RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY", "renewalApplicationDueDaysBeforeExpiry: "],
      ["ARTICLE_14C_SUSPENSION_LIMIT_YEARS", "article14cSuspensionLimitYears: "],
      ["CAPITAL_MAX_BRANCHES_BAND_1", "upToBranches: "],
      ["CAPITAL_MAX_BRANCHES_BAND_2", "upToBranches: "],
      ["CAPITAL_MIN_JOD_BAND_1", "Decimal('"],
      ["CAPITAL_MIN_JOD_BAND_2", "Decimal('"],
      ["CAPITAL_MIN_JOD_BAND_3", "Decimal('"],
    ];
    for (const [code, prefix] of mustAppear) {
      const value = LEGAL_VALUES.find((v) => v.code === code)?.value;
      expect(value, `${code} has no value in the catalogue`).not.toBeNull();
      expect(
        block![0],
        `the test double does not carry ${code}'s figure (${value}) — it would make six api specs ` +
          `assert licence behaviour against a figure the database no longer holds`,
      ).toContain(`${prefix}${value}`);
    }
  });

  it("art. 4/a's two figures the OCR gets wrong carry the warning in their own note", () => {
    // The extraction publishes 7,000 for the middle amount and 5 branches for the first boundary,
    // both marked «رقمٌ لاتينيٌّ ومن ثمّ موثوق». A reader who meets the figure must meet the
    // warning, because the mechanism — a Latin-digit OUTPUT read as evidence of a Latin-digit
    // INPUT — will produce the next wrong figure too.
    expect(
      LEGAL_VALUES.find((v) => v.code === "CAPITAL_MIN_JOD_BAND_2")?.note,
    ).toContain("7,000");
    expect(
      LEGAL_VALUES.find((v) => v.code === "CAPITAL_MAX_BRANCHES_BAND_1")?.note,
    ).toContain("publishes 5 here");
  });
});
