import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/*
 * `COMMISSION_ENTRY_STATUSES` IS DECLARED TWICE, IN TWO PACKAGES.
 *
 * `apps/api/src/modules/commission/commission.config.ts` declares the real set.
 * `apps/web/lib/commission/commission-api.ts` declares a hand-written copy, because the web has no
 * import path into an api module — two packages, two builds.
 *
 * ## WHY THIS GUARD EXISTS, AND WHAT IT IS GUARDING AGAINST IS ALREADY ON THE RECORD
 *
 * Before 2026-11-06 the web declared `status: string` and its label map was
 * `Record<string, TranslationKey>` over FOUR keys. Measured against the api, the real set is three:
 * `outstanding | paid | reversed`. So `calculated` and `approved` were entries for states that
 * cannot occur, `reversed` — which can — was ABSENT, and the call site carried
 * `?? 'commissionStatusDraft'`. Two of the three statuses that really exist therefore rendered as
 * «مسوَّدة» / "Draft": an entry that is posted but not collected, and one that has been fully
 * clawed back. A reversed commission reading "Draft" on the policy screen is the dangerous half.
 *
 * The map is total now, so the COMPILER covers the second half of the job: adding a member to the
 * WEB union without deciding its word is a type error. It cannot cover the FIRST half. A fourth
 * status added in the api ALONE makes `COMMISSION_STATUS_LABEL_KEY[entry.status]` return
 * `undefined`, `t(undefined)` renders nothing, and the status cell goes BLANK with nothing failing
 * anywhere — on a card showing money owed to the office. This is the only mechanism that can see
 * that, which is the argument `capability-note-parity.spec.ts` makes for itself and the reason it,
 * `audit-action-parity`, `notification-kinds-parity`, `legacy-import-shape-parity`,
 * `workflow-entity-type-parity` and `office-administrator-grants.parity` all sit here rather than
 * in either package: `packages/db` is the only place that can SEE both. A spec in `apps/web`
 * reading an `apps/api` path typechecks on a laptop and fails inside the image, because
 * `turbo prune web --docker` keeps only web's workspace dependencies and `apps/api` is not one.
 *
 * The other direction is caught too, so the copy cannot become a ceiling: a status REMOVED from the
 * api and left in the web is an entry nothing can reach.
 *
 * ## BOTH FILES DECLARE THE SAME SHAPE ON PURPOSE
 *
 * Both are `export const COMMISSION_ENTRY_STATUSES = [ … ] as const;`, so ONE pattern reads both.
 * The alternative — an array in the api and a `|` union in the web — needs two patterns, and a
 * regex that silently stops matching is this family's recorded failure mode: the audit-action
 * guard's first version read 4 of 20 values because a comment inside the union contained a
 * semicolon. One shape, one pattern, and a floor below.
 */

const REPO = path.join(__dirname, "..", "..", "..");

const API_CONFIG = path.join(
  REPO,
  "apps",
  "api",
  "src",
  "modules",
  "commission",
  "commission.config.ts",
);

const WEB_API = path.join(
  REPO,
  "apps",
  "web",
  "lib",
  "commission",
  "commission-api.ts",
);

/** The web component that must hold a label for every member. */
const WEB_SECTION = path.join(
  REPO,
  "apps",
  "web",
  "components",
  "policy",
  "CommissionSection.tsx",
);

/**
 * Below today's three, deliberately. Its job is NOT to pin the count — legitimately removing a
 * status should fail the parity assertion that NAMES the member, not a floor one less. Its job is
 * to catch a pattern that stopped matching, which is how drift gets back in through a refactor of a
 * file this guard reads.
 */
const STATUS_FLOOR = 2;

/**
 * Reads `export const COMMISSION_ENTRY_STATUSES = [\n  'a',\n  'b',\n] as const;` as text.
 *
 * ## THE ANCHOR IS THE DECLARATION, NOT THE NAME, AND A PLANT IS WHY
 *
 * This first did `text.indexOf("COMMISSION_ENTRY_STATUSES")`. Planting a RENAME of the web constant
 * left all four tests GREEN — because the name still appeared twice in that file's own prose (its
 * doc comment cites the api's constant, and the derived type references it), so `indexOf` matched a
 * COMMENT, the `] as const` search then found the real array below it, and the slice captured the
 * three members anyway. The guard read the right values from the wrong place and could not tell.
 *
 * That is this family's recorded failure mode arriving one level in: the audit-action guard's first
 * version read 4 of 20 values because a comment inside the union held a semicolon. A guard anchored
 * on a string that also occurs in prose is anchored on nothing.
 *
 * So the anchor is now the `export const … = [` DECLARATION, which cannot appear in prose, and the
 * failure is explicit rather than a silent fall-through to a floor.
 *
 * Bounded on the `] as const` that closes the literal rather than on "the next bracket", so a later
 * array in the same file cannot extend the slice.
 */
function readStatuses(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const declaration = /export const COMMISSION_ENTRY_STATUSES\s*=\s*\[/.exec(
    text,
  );
  expect(
    declaration,
    `'export const COMMISSION_ENTRY_STATUSES = [' not found in ${file} — it was renamed or restructured, so this guard is now BLIND. Re-point it; do not delete it.`,
  ).not.toBeNull();
  const start = declaration!.index;
  const end = text.indexOf("] as const", start);
  expect(
    end,
    `the '] as const' closing COMMISSION_ENTRY_STATUSES not found in ${file}`,
  ).toBeGreaterThan(start);
  const slice = text.slice(start, end);
  return [...slice.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("CommissionLedgerEntry.status — api and web agree", () => {
  const api = readStatuses(API_CONFIG);
  const web = readStatuses(WEB_API);

  it("reads a plausible number of statuses from BOTH files (the pattern still matches)", () => {
    // Non-vacuity. Without this, a renamed constant makes both sides read [] and the parity
    // assertion below passes while the guard sees nothing at all.
    expect(api.length).toBeGreaterThan(STATUS_FLOOR);
    expect(web.length).toBeGreaterThan(STATUS_FLOOR);
  });

  it("declares exactly the same status set in both packages", () => {
    // Sorted and compared as sets: the DECLARATION ORDER is free to differ, the membership is not.
    expect([...web].sort()).toEqual([...api].sort());
  });

  it("gives every api status a label in the web's status map", () => {
    // The third, differently-parsed list — the thing that catches two copies agreeing with each
    // other while both are wrong. `COMMISSION_STATUS_LABEL_KEY` is total over the web union, so
    // the compiler already ties it to `web`; reading it as TEXT ties it to `api` as well.
    const section = fs.readFileSync(WEB_SECTION, "utf8");
    const start = section.indexOf("COMMISSION_STATUS_LABEL_KEY: Record<");
    expect(
      start,
      "COMMISSION_STATUS_LABEL_KEY not found in CommissionSection.tsx",
    ).toBeGreaterThan(-1);
    const end = section.indexOf("};", start);
    const body = section.slice(start, end);
    for (const status of api) {
      expect(
        body,
        `${status} is a real CommissionLedgerEntry status with no entry in COMMISSION_STATUS_LABEL_KEY — the status cell renders BLANK for it`,
      ).toContain(`${status}:`);
    }
  });

  it("has no label-map entry for a status the api does not have", () => {
    const section = fs.readFileSync(WEB_SECTION, "utf8");
    const start = section.indexOf("COMMISSION_STATUS_LABEL_KEY: Record<");
    const end = section.indexOf("};", start);
    const mapped = [
      ...section.slice(start, end).matchAll(/^\s{2}([a-z_]+):/gm),
    ].map((m) => m[1]);
    // This is the assertion that would have caught `calculated` and `approved` — four years of
    // nobody noticing two entries for states that cannot occur.
    expect([...mapped].sort()).toEqual([...api].sort());
  });
});
