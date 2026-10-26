import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/*
 * THE CUSTOMER-IMPORT RESPONSE IS DECLARED TWICE, IN TWO PACKAGES, AND THE COPY WENT STALE FOR
 * THREE WEEKS WHILE EVERY GATE STAYED GREEN.
 *
 * `apps/api/src/modules/customer/legacy-import.config.ts` declares `LegacyImportResult` and
 * `LegacyImportIssueView`: what `POST /imports/customers` returns.
 * `apps/web/lib/customer/legacy-import-api.ts` declares `ImportResult` and `ImportIssue`, a
 * hand-written copy, because the web has no import path to an api module.
 *
 * ## What actually happened, which is why this file exists rather than a third mock
 *
 * Phase 2 item 1 replaced the api's `rejections` and `failures` with ONE `issues` list carrying a
 * `kind`, plus `refusedDuplicates` and `batchId`. The web was not updated. The screen then evaluated
 * `result.rejections.length + result.failures.length` — both `undefined` — and **threw during render
 * on every successful import**: the rows went into the book and the panel reporting on them died.
 *
 * Three things all failed to see it, and each failure is a general one:
 *
 *   1. **TypeScript cannot check an interface a screen declares by hand over an HTTP response.** The
 *      web's `ImportResult` was internally consistent and entirely wrong.
 *   2. **The Playwright fixture supplied the old fields itself.** A mocked endpoint cannot refuse
 *      you, and it cannot drop a field the real api dropped — so the suite was green against a shape
 *      the server had stopped sending. Adding assertions to that spec would not have helped.
 *   3. **The api e2e asserts the response it gets**, which was correct. Both sides were right about
 *      themselves.
 *
 * The only instrument that can catch the class is one that reads BOTH DECLARATIONS AS TEXT, which is
 * what this does. `CLAUDE.md`'s 2026-10-02 row named exactly this remedy — *"a third parity guard
 * over the import's response shape, not a patch to line 221"* — and it is the fourth now, beside
 * `audit-action-parity.spec.ts`, `notification-kinds-parity.spec.ts` and
 * `workflow-entity-type-parity.spec.ts`.
 *
 * ## Why here, in `packages/db`, which owns neither declaration
 *
 * Because it is the only place that can SEE both. A spec in `apps/web` reading an `apps/api` path
 * typechecks on a laptop and fails inside the image — `turbo prune web --docker` keeps only web's
 * workspace dependencies, and `apps/api` is not one. Mirrored, the same. Its three siblings live
 * here for exactly that reason.
 *
 * ## What this guard does NOT cover, stated rather than discovered
 *
 * The two BATCH routes (`GET /imports/customers/batches` and `.../batches/:id`) return RAW Prisma
 * rows — the api has no declared view for them — so there is no api-side interface to compare, and
 * the web declares only the subset of columns it reads. That direction is held by the api e2e's own
 * key-set assertions and by nothing here. A derived view for those two is what would bring them in.
 */

const REPO = path.join(__dirname, "..", "..", "..");

const API_FILE = path.join(
  REPO,
  "apps",
  "api",
  "src",
  "modules",
  "customer",
  "legacy-import.config.ts",
);
const WEB_FILE = path.join(
  REPO,
  "apps",
  "web",
  "lib",
  "customer",
  "legacy-import-api.ts",
);

/**
 * The FIELD NAMES of one `export interface`, read as text.
 *
 * Comments are stripped FIRST, and that is not tidiness: both files document these fields heavily,
 * and a doc comment containing the word `issues:` or a `/** Rows refused ... *\/` line would be read
 * as a field. The same lesson as the seed-sweep gate, which reported a model as cleared because its
 * name appeared in a comment.
 */
function interfaceFields(source: string, name: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const at = stripped.indexOf(`export interface ${name} `);
  if (at === -1) {
    throw new Error(
      `legacy-import-shape-parity: no \`export interface ${name}\` — it was renamed or removed, ` +
        `and this guard must be re-pointed rather than deleted.`,
    );
  }
  const open = stripped.indexOf("{", at);
  const close = stripped.indexOf("\n}", open);
  if (open === -1 || close === -1) {
    throw new Error(
      `legacy-import-shape-parity: could not find the body of ${name}.`,
    );
  }
  const body = stripped.slice(open + 1, close);
  // `name?:` and `name!:` both count, and the `!` form is the api's (its DTO-adjacent style).
  const fields = [...body.matchAll(/^\s{2}(\w+)[?!]?\s*:/gm)].map((m) => m[1]!);
  return [...new Set(fields)].sort();
}

const api = fs.readFileSync(API_FILE, "utf8");
const web = fs.readFileSync(WEB_FILE, "utf8");

describe("the customer-import response shape is declared twice and the copies must agree", () => {
  /*
   * THE NON-VACUITY FLOOR FIRST. A parser that stops matching reports a clean nothing, and two empty
   * field lists would compare EQUAL — the shape of four wrong measurements in this repository's own
   * history. The floors are minimums rather than pins so adding a field does not fail them.
   */
  it("reads real field lists from both declarations", () => {
    expect(interfaceFields(api, "LegacyImportResult").length).toBeGreaterThan(5);
    expect(interfaceFields(web, "ImportResult").length).toBeGreaterThan(5);
    expect(
      interfaceFields(api, "LegacyImportIssueView").length,
    ).toBeGreaterThan(2);
    expect(interfaceFields(web, "ImportIssue").length).toBeGreaterThan(2);
  });

  it("the RESULT carries exactly the same fields on both sides", () => {
    /*
     * THE DIRECTION THAT BROKE THE SCREEN is a field the WEB declares and the api does not: it is
     * `undefined` at runtime, no type sees it, and the screen reads it. The other direction — a
     * field the api sends and the web ignores — is harmless on its own and is still caught, because
     * an api field nobody reads is how a capability ships with no reader (`batchId` was exactly
     * that for three weeks).
     */
    expect(interfaceFields(web, "ImportResult")).toEqual(
      interfaceFields(api, "LegacyImportResult"),
    );
  });

  it("the ISSUE carries exactly the same fields on both sides", () => {
    expect(interfaceFields(web, "ImportIssue")).toEqual(
      interfaceFields(api, "LegacyImportIssueView"),
    );
  });

  it("the ISSUE KIND is the same closed three on both sides", () => {
    /*
     * The kinds are a union in both files rather than a named list, so they are read as the quoted
     * members of the `kind` field's type. A kind added in the api alone would make
     * `ISSUE_KIND_LABEL[kind]` `undefined` — which the screen handles by rendering the member name,
     * deliberately — but it would also mean a refusal reason the office is shown a raw name for
     * while nobody knows the word is owed. This is where that becomes visible.
     */
    const kinds = (source: string): string[] => {
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      /*
       * TWO SHAPES, AND THE PARSER HAD TO LEARN THE SECOND RATHER THAN THE SECOND SIDE BEING WRONG.
       * The api declares the union INLINE on the field (`kind: 'A' | 'B' | 'C';`); the web declares a
       * NAMED alias (`export type ImportIssueKind = ...`) and the field refers to it. My first
       * version read only the inline form, so the web side parsed to `[]` — and **two empty lists
       * compare EQUAL**, so without the floor above this guard would have reported agreement between
       * a real list and nothing at all. That is why the floor is an assertion and not a comment.
       *
       * ONE level of indirection and no more: an alias whose value is another alias is not followed,
       * because that needs a real resolver and this is a text parser. It would surface as a parse of
       * fewer than three, which the floor refuses by name.
       */
      const declarations = [
        ...stripped.matchAll(
          /(?:\bkind[?!]?\s*:|export type \w*Kind\s*=)([^;]*);/g,
        ),
      ].map((m) => m[1]!);
      const found: string[] = [];
      for (const decl of declarations) {
        found.push(...[...decl.matchAll(/'(\w+)'/g)].map((m) => m[1]!));
      }
      return [...new Set(found)].sort();
    };
    const apiKinds = kinds(api);
    expect(
      apiKinds.length,
      "the api-side kind union parsed to nothing — the guard is broken, not the code",
    ).toBe(3);
    expect(kinds(web)).toEqual(apiKinds);
  });

  it("neither side still declares the fields that caused the crash", () => {
    /*
     * AN ABSENCE, ASSERTED, because it is the only form that can fail. `rejections` and `failures`
     * are GONE from the api, and the equality above would already catch them coming back on ONE
     * side — but not on both at once, which is exactly how they got here (two arrays distinguished
     * only by their field name, the shape that let a reader treat an imported-but-unscreened row as
     * a refusal).
     */
    for (const dead of ["rejections", "failures"]) {
      expect(interfaceFields(api, "LegacyImportResult")).not.toContain(dead);
      expect(interfaceFields(web, "ImportResult")).not.toContain(dead);
    }
  });
});

/**
 * The string members of one exported array literal, read as text.
 *
 * Comments stripped first, for the same reason as `interfaceFields`: both of these
 * declarations carry doc comments that NAME the fields in prose — the api's says
 * «`legalName` is the only one without which a row is not a customer at all» — and
 * a parser that read the comment would find `legalName` whether the array held it
 * or not.
 */
function arrayMembers(source: string, name: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const at = stripped.indexOf(`export const ${name}`);
  if (at === -1) {
    throw new Error(
      `legacy-import-shape-parity: no \`export const ${name}\` — it was renamed or ` +
        `removed, and this guard must be re-pointed rather than deleted.`,
    );
  }
  // The `=` FIRST, then the `[`. Taking the first `[` after the name finds the one
  // inside a TYPE ANNOTATION — `LEGACY_IMPORT_REQUIRED_FIELDS: LegacyImportField[]`
  // — and the matching `]` is right behind it, so the body parsed to EMPTY. Both
  // required lists read as `[]` on the first run and the non-vacuity floor refused
  // rather than reporting two empty arrays as equal, which is the only reason this
  // was visible at all.
  const eq = stripped.indexOf("=", at);
  const open = stripped.indexOf("[", eq);
  const close = stripped.indexOf("]", open);
  if (eq === -1 || open === -1 || close === -1) {
    throw new Error(
      `legacy-import-shape-parity: could not find the body of ${name}.`,
    );
  }
  return [...stripped.slice(open + 1, close).matchAll(/'(\w+)'/g)].map(
    (m) => m[1]!,
  );
}

/*
 * THE IMPORTER'S FIELD LIST IS DECLARED TWICE TOO, AND NOTHING COMPARED THEM.
 *
 * The web's copy carries the comment «Mirrors `LEGACY_IMPORT_FIELDS`» and that
 * comment was the whole of the guarantee. The response shape above went stale for
 * three weeks under exactly that arrangement.
 *
 * What makes it load-bearing now rather than tidy: the owner asked for the import
 * screen to GENERATE A TEMPLATE from the importer's own field list — «احنا احكينا
 * مش رح يطلع من النظام زي قالب عشان المكتب يعبّيه بمعلومات عملائه كاملين و يرفعهم
 * مرة وحدة» — and that template is built from the WEB's copy, because the web is
 * where the Arabic labels are. So a stale copy no longer just mis-renders a mapping
 * row: it hands the office a spreadsheet missing a column the importer accepts, or
 * naming one it does not, and the office fills it in before anything refuses.
 *
 * ORDER IS ASSERTED, not just membership. The template's columns come out in this
 * order, and the mapping is pre-filled from it; two lists holding the same seven
 * names in different orders would pass a set comparison and produce a template
 * whose columns do not line up with what the screen says they are.
 */
describe("the importer's field list is declared twice and the copies must agree", () => {
  it("reads real lists from both declarations", () => {
    // The floor first. Two empty arrays compare EQUAL, which is how a broken
    // parser reports agreement — the shape this repository has paid for four
    // times. A minimum rather than a pin, so an eighth field does not fail it.
    expect(
      arrayMembers(api, "LEGACY_IMPORT_FIELDS").length,
      "the api-side field list parsed to nothing — the guard is broken, not the code",
    ).toBeGreaterThan(5);
    expect(arrayMembers(web, "IMPORT_FIELDS").length).toBeGreaterThan(5);
    expect(
      arrayMembers(api, "LEGACY_IMPORT_REQUIRED_FIELDS").length,
    ).toBeGreaterThan(0);
    expect(arrayMembers(web, "IMPORT_REQUIRED_FIELDS").length).toBeGreaterThan(
      0,
    );
  });

  it("holds the same importable fields IN THE SAME ORDER", () => {
    expect(arrayMembers(web, "IMPORT_FIELDS")).toEqual(
      arrayMembers(api, "LEGACY_IMPORT_FIELDS"),
    );
  });

  it("agrees on which fields are REQUIRED", () => {
    // A field required by the api and optional on the web is a template that marks
    // a column optional and an import that then refuses the file — after the office
    // has filled it in, which is the expensive moment to find out.
    expect(arrayMembers(web, "IMPORT_REQUIRED_FIELDS")).toEqual(
      arrayMembers(api, "LEGACY_IMPORT_REQUIRED_FIELDS"),
    );
  });

  it("requires nothing the importer does not accept", () => {
    const fields = arrayMembers(api, "LEGACY_IMPORT_FIELDS");
    for (const required of arrayMembers(api, "LEGACY_IMPORT_REQUIRED_FIELDS")) {
      expect(fields, `${required} is required but not importable`).toContain(
        required,
      );
    }
  });
});
