import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/*
 * `WorkflowEntityType` IS DECLARED TWICE, IN TWO PACKAGES, AND NOTHING CHECKED THAT THEY AGREE.
 *
 * `apps/api/src/modules/workflow/workflow-transitions.config.ts` declares the eighteen entity names the
 * transition engine knows. `apps/web/lib/audit-trail/workflow-entity-types.ts` declares a hand-written
 * copy, because the web has no import path to an api module — two packages, two builds.
 *
 * Owner decision 41 is what made the copy load-bearing: `/audit-trail`'s workflow-history field used to
 * be FREE TEXT, so a drifted list cost nothing. It is now a `<select>` built from the web's copy, which
 * means the copy decides what a compliance officer can look up at all.
 *
 * ## The two directions produce different defects, and the first is the one that matters
 *
 * A member ADDED IN THE API AND NOT HERE silently disappears from the dropdown. There is no error and
 * nothing fails: the reader simply cannot select that type, and the most likely conclusion is that the
 * record has no history. A new workflow entity is exactly when somebody wants its history.
 *
 * A member REMOVED FROM THE API and left in the web is rot rather than a defect: an option that returns
 * an empty history, which reads as "nothing ever happened to this record". Caught here too.
 *
 * ## Why here, in `packages/db`, which owns neither list
 *
 * Because it is the only place that can SEE both. A spec in `apps/web` reading an `apps/api` path
 * typechecks on a laptop and fails inside the image — `turbo prune web --docker` keeps only web's
 * workspace dependencies, and apps/api is not one. `audit-action-parity.spec.ts` and
 * `notification-kinds-parity.spec.ts` are this file's precedents and sit here for the same reason.
 *
 * ## What the compiler already covers, so this does not
 *
 * `WORKFLOW_ENTITY_LABEL` is a total `satisfies Record<WorkflowEntityType, TranslationKey | null>`, so
 * adding a member to the WEB's union without deciding its label is a type error, and a label naming a
 * key the dictionary does not hold is also a type error. Both are real and neither is this guard: they
 * fire only once somebody has already copied the member across, and the copy is what no type can see.
 */

const REPO = path.join(__dirname, "..", "..", "..");

const API_UNION = path.join(
  REPO,
  "apps",
  "api",
  "src",
  "modules",
  "workflow",
  "workflow-transitions.config.ts",
);

const WEB_UNION = path.join(
  REPO,
  "apps",
  "web",
  "lib",
  "audit-trail",
  "workflow-entity-types.ts",
);

/**
 * THE THREE MEMBERS THAT MAY CARRY NO WORD — an UPPER BOUND, never an equality.
 *
 * A `null` label renders the member name verbatim rather than a guessed Arabic word, and three members
 * are in that state: `Endorsement` and `Invoice` have no screen under `app/(app)` to take a heading
 * from, and `/opportunities`' own `<h1>` names the RFQ rather than the Opportunity.
 *
 * Asserted as a SUBSET so that filling one in PASSES. An equality here would go red the day the owner
 * writes one of the three words — a gate failing because somebody did the work it exists to support,
 * which this repository has already paid for once in the permission-description harvest.
 */
const MAY_HAVE_NO_LABEL = ["Opportunity", "Endorsement", "Invoice"];

/** Below today's eighteen, so deliberately removing a member does not fail THIS assertion instead of
 *  the real one. Its job is to catch a regex that stopped matching, which is the failure mode that
 *  lets drift back in through a refactor of a file this guard reads. */
const FLOOR = 15;

/**
 * Reads `export type WorkflowEntityType =\n  | 'A'\n  | 'B';` as text.
 *
 * Bounded on `';` followed by a newline — the punctuation that closes the last member — rather than on
 * "the next semicolon". The audit-action guard's own history is why: its first version cut at the next
 * `;` and read 4 of 20 values, because a comment inside the union contained a semicolon in ordinary
 * English prose. The author's own comment broke the author's own parser.
 */
function unionIn(file: string, label: string): string[] {
  expect(
    fs.existsSync(file),
    `${file} does not exist — this guard is reading nothing, and would pass by finding no drift.`,
  ).toBe(true);
  const source = fs.readFileSync(file, "utf8");
  const marker = "export type WorkflowEntityType =";
  const start = source.indexOf(marker);
  expect(
    start,
    `${label}: WorkflowEntityType has been renamed, moved, or is no longer a plain string union`,
  ).toBeGreaterThan(-1);
  const end = source.indexOf("';\n", start);
  expect(
    end,
    `${label}: the union is not closed by "';" — if it became computed or imported, this guard cannot read it and must not pretend to`,
  ).toBeGreaterThan(start);
  // `end + 1` INCLUDES the closing quote of the last member. Without it the slice stops one character
  // short, the final member loses its closing `'`, and the `'(\w+)'` pattern silently drops it — both
  // unions then read 17 of 18 and AGREE WITH EACH OTHER, so the two parity assertions pass and only the
  // label-map comparison notices. Caught by that third assertion, which is the argument for comparing
  // against a list parsed a different way rather than only the two that share a parser.
  return [...source.slice(start, end + 1).matchAll(/'(\w+)'/g)].map(
    (m) => m[1]!,
  );
}

/** The keys of `WORKFLOW_ENTITY_LABEL`, and which of them carry `null`. */
function labelMap(): { keys: string[]; nulls: string[] } {
  const source = fs.readFileSync(WEB_UNION, "utf8");
  const start = source.indexOf("export const WORKFLOW_ENTITY_LABEL = {");
  expect(
    start,
    "WORKFLOW_ENTITY_LABEL has been renamed or is no longer a plain object literal",
  ).toBeGreaterThan(-1);
  const end = source.indexOf("} satisfies", start);
  expect(
    end,
    'WORKFLOW_ENTITY_LABEL is no longer closed by "} satisfies" — the total-map guarantee is what makes a missing label a type error, so losing it is the finding',
  ).toBeGreaterThan(start);
  const body = source.slice(start, end);
  const entries = [...body.matchAll(/^\s{2}(\w+):\s*(null|'[\w.-]+')/gm)];
  return {
    keys: entries.map((m) => m[1]!),
    nulls: entries.filter((m) => m[2] === "null").map((m) => m[1]!),
  };
}

describe("WorkflowEntityType — the api's union and the web's copy agree", () => {
  const api = unionIn(API_UNION, "apps/api");
  const web = unionIn(WEB_UNION, "apps/web");
  const { keys: labelled, nulls } = labelMap();

  it("is not vacuous — all three lists are substantial", () => {
    expect(api.length).toBeGreaterThanOrEqual(FLOOR);
    expect(web.length).toBeGreaterThanOrEqual(FLOOR);
    expect(labelled.length).toBeGreaterThanOrEqual(FLOOR);
  });

  it("the web can OFFER every entity the engine knows", () => {
    // The direction that matters: a type the engine transitions and the screen cannot select. The
    // message names the members rather than reporting a length mismatch.
    expect(api.filter((k) => !web.includes(k))).toEqual([]);
  });

  it("the web offers no entity the engine does not know", () => {
    expect(web.filter((k) => !api.includes(k))).toEqual([]);
  });

  it("every entity the engine knows has an entry in the label map", () => {
    // Separate from the union check and not redundant with the compiler: the map is total over the
    // WEB's union, so it is complete with respect to a copy that may itself be short. This asserts it
    // against the API's list, which is what the engine actually writes history for.
    expect(api.filter((k) => !labelled.includes(k))).toEqual([]);
  });

  it("the label map names nothing the engine does not know", () => {
    expect(labelled.filter((k) => !api.includes(k))).toEqual([]);
  });

  it("only the three declared members carry no label", () => {
    // A SUBSET check: filling one in passes, adding a fourth unworded member fails by name. The point
    // is that a `null` renders an English member name into an Arabic dropdown, which is acceptable for
    // three declared cases awaiting the owner's own words and is not a thing to acquire quietly.
    expect(nulls.filter((k) => !MAY_HAVE_NO_LABEL.includes(k))).toEqual([]);
  });

  it("the api's declaration order is preserved, because the select renders in it", () => {
    // Not cosmetic: `WORKFLOW_ENTITY_TYPES` is `Object.keys` of the label map, so the map's order IS
    // the dropdown's order. Sorting it alphabetically would scatter the eighteen across the list and
    // move every option the next time a member is added.
    expect(web).toEqual(api);
    expect(labelled).toEqual(api);
  });

  it("has no duplicates in either list", () => {
    expect(new Set(api).size).toBe(api.length);
    expect(new Set(web).size).toBe(web.length);
  });
});
