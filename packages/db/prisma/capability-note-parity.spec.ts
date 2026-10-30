import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/*
 * `ProviderCapability` AND `CapabilityNoteKey` ARE EACH DECLARED TWICE, IN TWO PACKAGES.
 *
 * `apps/api/src/modules/screening-providers/screening-provider.types.ts` declares both unions.
 * `apps/web/lib/screening/screening-config-api.ts` declares a hand-written copy of each, because
 * the web has no import path to an api module — two packages, two builds.
 *
 * ## A COMMENT OF MINE CLAIMED THE COMPILER COVERS THIS. IT DOES NOT.
 *
 * That web file used to say, of the capability union: *"A third capability added to the api should
 * be a COMPILE ERROR in the web."* False for a value arriving over HTTP. The compile error fires
 * when somebody edits the WEB union — which is the second half of the job, not the first. A member
 * added in the api ALONE makes `PROVIDER_CAPABILITY_LABEL_KEY[c.capability]` return `undefined`,
 * `t(undefined)` renders nothing, and the row loses its label with nothing failing anywhere.
 *
 * This guard is what makes it fail. It is the only mechanism that can.
 *
 * ## The note keys are the worse of the two, because the sentence is the whole content
 *
 * A note key added in the api and not here resolves to `undefined` in
 * `CAPABILITY_NOTE_LABEL_KEY`, and the note DISAPPEARS — on the screen whose job is to say
 * whether customers are actually being screened, under a row of ticks that then explains nothing.
 * Before owner decision 2's follow-up the api sent the sentence itself, so drift was impossible
 * and this guard was unnecessary; moving the words into the dictionary is what made the copy
 * load-bearing, exactly as decision 41 did for the workflow entity types.
 *
 * The other direction is rot rather than a defect: a key removed from the api and left here is an
 * entry nothing can reach. Caught too, so the list cannot become a ceiling.
 *
 * ## Why here, in `packages/db`, which owns neither list
 *
 * Because it is the only place that can SEE both. A spec in `apps/web` reading an `apps/api` path
 * typechecks on a laptop and fails inside the image — `turbo prune web --docker` keeps only web's
 * workspace dependencies, and `apps/api` is not one. `audit-action-parity.spec.ts`,
 * `notification-kinds-parity.spec.ts`, `legacy-import-shape-parity.spec.ts` and
 * `workflow-entity-type-parity.spec.ts` are this file's four precedents and sit here for the same
 * reason.
 *
 * ## What the compiler DOES cover, so this does not
 *
 * Both web maps are total `Record<Union, TranslationKey>` with no `null` member, so adding a
 * member to the WEB's union without deciding its word is a type error, and a key naming a string
 * the dictionary does not hold is also a type error. Both are real and neither is this guard:
 * they fire only once the member has been copied across, and the copy is what no type can see.
 */

const REPO = path.join(__dirname, "..", "..", "..");

const API_TYPES = path.join(
  REPO,
  "apps",
  "api",
  "src",
  "modules",
  "screening-providers",
  "screening-provider.types.ts",
);

const WEB_TYPES = path.join(
  REPO,
  "apps",
  "web",
  "lib",
  "screening",
  "screening-config-api.ts",
);

/** The four adapters that BUILD the notes. A key no adapter produces is a key nothing can show. */
const ADAPTERS = [
  "built-in-watchlist",
  "commercial",
  "on-premise",
  "not-configured",
].map((f) =>
  path.join(
    REPO,
    "apps",
    "api",
    "src",
    "modules",
    "screening-providers",
    `${f}.provider.ts`,
  ),
);

/**
 * Below today's figures, deliberately, so legitimately REMOVING a member fails the parity
 * assertion that names it rather than this floor at one less. Its job is the other one: catching a
 * regex that stopped matching, which is the failure mode that lets drift back in through a
 * refactor of a file this guard reads — and which has bitten the audit-action guard, whose first
 * version read 4 of 20 values because a comment inside the union contained a semicolon.
 */
const CAPABILITY_FLOOR = 7;
const NOTE_KEY_FLOOR = 20;

/**
 * Reads `export type X =\n  | 'A'\n  | 'B';` as text.
 *
 * Bounded on `';` followed by a newline — the punctuation that closes the last member — rather
 * than on "the next semicolon", for the reason in the floor comment above. `end + 3` INCLUDES that
 * closing quote: without it the slice stops short, the last member loses its `'`, and the pattern
 * drops it silently — which makes BOTH unions read one short and AGREE WITH EACH OTHER, so a
 * parity assertion passes while both are wrong. That is a defect the workflow-entity guard
 * actually shipped and caught with a third, differently-parsed list; here the adapter-coverage
 * assertion below is that third list.
 */
function unionIn(file: string, typeName: string, label: string): string[] {
  expect(
    fs.existsSync(file),
    `${file} does not exist — this guard is reading nothing, and would pass by finding no drift.`,
  ).toBe(true);
  const source = fs.readFileSync(file, "utf8");
  const marker = `export type ${typeName} =`;
  const start = source.indexOf(marker);
  expect(
    start,
    `${label}: ${typeName} has been renamed, moved, or is no longer a plain string union`,
  ).toBeGreaterThan(-1);
  const end = source.indexOf("';\n", start);
  expect(
    end,
    `${label}: ${typeName} is not closed by "';" — if it became computed or imported, this guard cannot read it and must not pretend to`,
  ).toBeGreaterThan(start);
  return [...source.slice(start, end + 3).matchAll(/'([A-Z_]+)'/g)].map(
    (m) => m[1]!,
  );
}

/** The body of a total `Record<…, TranslationKey>` object literal, as text. */
function mapBody(constName: string): string {
  const source = fs.readFileSync(WEB_TYPES, "utf8");
  const start = source.indexOf(`export const ${constName}`);
  expect(
    start,
    `${constName} has been renamed or is no longer a plain object literal`,
  ).toBeGreaterThan(-1);
  const open = source.indexOf("= {", start);
  const end = source.indexOf("\n};", open);
  expect(
    end,
    `${constName} is not closed by a plain "};" — this guard cannot read it`,
  ).toBeGreaterThan(open);
  return source.slice(open, end);
}

/** The keys of a total `Record<…, TranslationKey>` object literal. */
function mapKeys(constName: string): string[] {
  return [...mapBody(constName).matchAll(/^\s{2}([A-Z][A-Z_]*):/gm)].map(
    (m) => m[1]!,
  );
}

describe("ProviderCapability — the api and the web agree", () => {
  it("declares the same members in both packages", () => {
    const api = unionIn(API_TYPES, "ProviderCapability", "api");
    const web = unionIn(WEB_TYPES, "ProviderCapability", "web");
    expect(
      api.length,
      "the api's capability union parsed to fewer members than exist — the regex has stopped matching, so this guard is reading almost nothing",
    ).toBeGreaterThanOrEqual(CAPABILITY_FLOOR);
    expect(
      [...web].sort(),
      "ProviderCapability has drifted. A member in the api and not the web renders a row with NO LABEL, because the lookup returns undefined and t(undefined) renders nothing — on the screen that says whether customers are screened. Copy it across and decide its word.",
    ).toEqual([...api].sort());
  });

  it("gives every member a label, with no null and no fall-through", () => {
    const api = unionIn(API_TYPES, "ProviderCapability", "api");
    expect(
      [...mapKeys("PROVIDER_CAPABILITY_LABEL_KEY")].sort(),
      "PROVIDER_CAPABILITY_LABEL_KEY is not total over the capability union",
    ).toEqual([...api].sort());
    expect(
      mapBody("PROVIDER_CAPABILITY_LABEL_KEY"),
      "PROVIDER_CAPABILITY_LABEL_KEY has regained a `null`. All nine words are the owner's and shipped on 2026-10-29; a null here is a fallback something can be added to, which is why AR_AGEING_BUCKET_FALLBACK was deleted rather than emptied.",
    ).not.toContain("null");
    expect(
      mapBody("CAPABILITY_NOTE_LABEL_KEY"),
      "CAPABILITY_NOTE_LABEL_KEY has gained a `null`. A note with no sentence is a row of ticks that explains nothing.",
    ).not.toContain("null");
  });
});

describe("CapabilityNoteKey — the api, the web, and the adapters agree", () => {
  it("declares the same keys in both packages", () => {
    const api = unionIn(API_TYPES, "CapabilityNoteKey", "api");
    const web = unionIn(WEB_TYPES, "CapabilityNoteKey", "web");
    expect(
      api.length,
      "the api's note-key union parsed to fewer keys than exist — the regex has stopped matching",
    ).toBeGreaterThanOrEqual(NOTE_KEY_FLOOR);
    expect(
      [...web].sort(),
      "CapabilityNoteKey has drifted. A key in the api and not the web makes the note DISAPPEAR — the row keeps its ticks and explains nothing. Copy it across and give it its sentence in both languages.",
    ).toEqual([...api].sort());
  });

  it("resolves every key to a dictionary key", () => {
    const api = unionIn(API_TYPES, "CapabilityNoteKey", "api");
    expect(
      [...mapKeys("CAPABILITY_NOTE_LABEL_KEY")].sort(),
      "CAPABILITY_NOTE_LABEL_KEY is not total over the note-key union",
    ).toEqual([...api].sort());
  });

  /*
   * THE THIRD LIST, PARSED A DIFFERENT WAY — which is what catches a shared parser being wrong in
   * both directions at once, the defect the workflow-entity guard shipped and found this way.
   *
   * It also catches the thing a union cannot: a key that NO adapter produces. Such a key is a
   * sentence in the dictionary nothing can ever render, and the register would go on saying a word
   * is in use when it is not. Both directions, so a key removed from an adapter fails too.
   */
  it("is produced by an adapter, every key, and no adapter names a key the union lacks", () => {
    const api = unionIn(API_TYPES, "CapabilityNoteKey", "api");
    const built = new Set<string>();
    for (const file of ADAPTERS) {
      expect(
        fs.existsSync(file),
        `${file} does not exist — an adapter has moved and this guard is reading nothing`,
      ).toBe(true);
      const source = fs.readFileSync(file, "utf8");
      for (const m of source.matchAll(
        /\b(?:describes|cautions)\(\s*'([A-Z_]+)'/g,
      )) {
        built.add(m[1]!);
      }
    }
    expect(
      built.size,
      "no adapter appears to build a note at all — `describes(`/`cautions(` matched nothing, so this assertion is reading an empty set",
    ).toBeGreaterThanOrEqual(NOTE_KEY_FLOOR);
    expect(
      [...built].sort(),
      "a CapabilityNoteKey is declared and built by no adapter (or an adapter names a key the union does not declare). A key nothing produces is a sentence in the dictionary nobody can ever see.",
    ).toEqual([...api].sort());
  });

  /*
   * THE OWNER NAMED THREE OF THESE SENTENCES AS WARNINGS and asked that each be verified to render
   * as one. The api declares that per note — decision 58's shape, because a screen cannot derive it
   * from three booleans and the commercial one rides a row where all three TICK.
   *
   * Pinned by NAME rather than by count: a count is satisfied by a substitution, and "which notes
   * are cautions" is precisely the thing a well-meaning edit changes. Two of the five are this
   * code's judgement rather than hers and are named in the api's `cautions()` doc comment; this
   * assertion is where overturning either becomes a deliberate act.
   */
  it("marks exactly the five cautions, by name", () => {
    const built: Record<string, string> = {};
    for (const file of ADAPTERS) {
      const source = fs.readFileSync(file, "utf8");
      for (const m of source.matchAll(
        /\b(describes|cautions)\(\s*'([A-Z_]+)'/g,
      )) {
        built[m[2]!] = m[1]!;
      }
    }
    const cautions = Object.entries(built)
      .filter(([, kind]) => kind === "cautions")
      .map(([key]) => key)
      .sort();
    expect(
      cautions,
      "the set of CAUTION notes has moved. Three are the owner's own classification (BUILT_IN_NO_PEP_DATA, COMMERCIAL_CONTRACT_COVERAGE, ON_PREMISE_PEP_SANCTIONS_ONLY) and two are declared as this code's judgement (BUILT_IN_CACHE_EMPTY, ON_PREMISE_PEP_VERIFY). A caution demoted to a description renders as grey text under a row of ticks, which is the defect she named by hand.",
    ).toEqual([
      "BUILT_IN_CACHE_EMPTY",
      "BUILT_IN_NO_PEP_DATA",
      "COMMERCIAL_CONTRACT_COVERAGE",
      "ON_PREMISE_PEP_SANCTIONS_ONLY",
      "ON_PREMISE_PEP_VERIFY",
    ]);
  });
});
