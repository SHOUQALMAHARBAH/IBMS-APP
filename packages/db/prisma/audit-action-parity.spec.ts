import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AuditAction } from "@prisma/client";

/*
 * A HAND-WRITTEN MIRROR OF A DATABASE ENUM DRIFTS, AND THE DRIFT IS SILENT UNTIL SOMETHING RENDERS IT.
 *
 * `apps/web/lib/audit-trail/audit-trail-api.ts` declares `AuditAction` as a string union, because the web
 * has no import path to the Prisma client's enum. That union was one value short for five commits: Class B
 * piece 1 added `DISCARD` to the database and nobody added it to the web.
 *
 * Nothing failed, and nothing could have. The type is only used to TYPE rows coming back from the API, and
 * TypeScript does not check a value arriving over HTTP against a union — a `DISCARD` row simply flowed
 * through a field declared as something else. The drift became visible the moment the audit screen gained
 * an action FILTER built from that union, where `DISCARD` would have been the single action a compliance
 * officer could not search for. Which is the one the discard feature exists to make findable.
 *
 * So the guard is not "the union is complete" as a style rule. It is: a filter built from this list offers
 * every action the database can store.
 *
 * ## AND THE COMPILER COVERS ONLY ONE DIRECTION, WHICH IS WHY THIS EXISTS
 *
 * `ENUM_LABEL.AuditAction` is a total `satisfies Labels<string>` map over the union, so ADDING a value to
 * the union without a label is a type error — that is how the three missing values surfaced the moment the
 * union was corrected (IMPROVEMENTS § 1.45's form-that-cannot-express-the-mistake).
 *
 * REMOVING one is not. Measured by planting exactly that: deleting `DISCARD` from the union again leaves
 * the label map holding a key for a member that no longer exists, `tsc` reports **0 errors**, and the
 * dropdown silently loses an option. The plant is `discard-dropped-from-the-union-again`, and this spec is
 * the only thing that failed on it.
 */

/** The web's copy, read as text because there is no import path to it from here. */
const MIRROR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "apps",
  "web",
  "lib",
  "audit-trail",
  "audit-trail-api.ts",
);

function mirroredActions(): string[] {
  expect(
    fs.existsSync(MIRROR),
    `${MIRROR} does not exist — this guard is reading nothing, and would pass by finding no drift.`,
  ).toBe(true);
  const source = fs.readFileSync(MIRROR, "utf8");
  const start = source.indexOf("export type AuditAction =");
  expect(start, "the web's AuditAction union has been renamed or moved").toBeGreaterThan(-1);
  // Sliced to the NEXT `export`, not to the next `;`.
  //
  // The first version cut at the next semicolon, which is where a type alias ends — and it read 4 of the
  // 20 values, because the explanatory comment inside the union contains a semicolon in ordinary prose.
  // My own comment broke my own parser. The non-vacuity assertion below is what caught it on the first
  // run, which is the whole reason that assertion is there rather than being obvious.
  const end = source.indexOf("export ", start + 1);
  expect(end, "the web's AuditAction union has no following export to bound it").toBeGreaterThan(start);
  // Only the quoted members, so a comment inside the union cannot contribute a value.
  return [...source.slice(start, end).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
}

describe("AuditAction — the web's union mirrors the database enum exactly", () => {
  const database = Object.values(AuditAction).map(String).sort();
  const mirror = mirroredActions();

  it("is not vacuous — both lists are substantial", () => {
    // Without this the guard passes when the regex matches nothing, which is the failure mode that would
    // let the drift back in through a refactor of the file it reads.
    expect(database.length).toBeGreaterThan(15);
    expect(mirror.length).toBeGreaterThan(15);
  });

  it("offers every action the database can store", () => {
    // Stated in this direction on purpose: a MISSING value is the defect that matters, because it is an
    // action nobody can filter for. The message names them.
    expect([...database].filter((a) => !mirror.includes(a))).toEqual([]);
  });

  it("offers nothing the database cannot store", () => {
    // The other direction is a filter option that always returns nothing — a worse kind of wrong answer
    // than an omission, because it looks like a conclusion about the data.
    expect(mirror.filter((a) => !database.includes(a))).toEqual([]);
  });

  it("has no duplicates in the mirror", () => {
    expect(new Set(mirror).size).toBe(mirror.length);
  });
});
