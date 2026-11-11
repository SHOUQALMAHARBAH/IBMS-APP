import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PERMISSIONS } from "./seed-data/permissions";

/*
 * THE PERMISSION CATALOGUE IS DECLARED TWICE, AND THE ARABIC-COVERAGE GUARD READS THE COPY.
 *
 * `packages/db/prisma/seed-data/permissions.ts` is the SOURCE: adding a permission to the system
 * means adding an entry there, and `db:seed` writes it into `Permission`.
 *
 * `apps/web/e2e/fixtures/role-permissions.ts` is a GENERATED MIRROR of the seeded database, used by
 * Playwright to mock `/auth/me` — and it is also what `apps/web/lib/admin/permission-descriptions.test.ts`
 * imports as `PERMISSION_CATALOGUE` to assert that every code has an Arabic description.
 *
 * ## Why this guard exists — a plant that killed nothing
 *
 * Measured 2026-11-10. A permission code with no Arabic description was added to the SEED and the
 * web unit suite stayed GREEN at 9/9, because the coverage guard's subject was the fixture: two hops
 * from where a permission is actually written. The same plant AT THE FIXTURE killed 2 of 9 and named
 * the code — so the guard was real, and pointed at a copy.
 *
 * The owner's instruction was to make the guard bite on what ships, by one of two routes: assert
 * against the seed directly, or prove the fixture cannot diverge from the seed. This is the second,
 * and it was chosen on a measurement rather than a preference:
 *
 *   - A web test cannot import the seed. `@ibms/db` exports only `.` and `./password-policy`, so the
 *     seed catalogue is not a reachable subpath, and a RELATIVE import out of `apps/web` into
 *     `packages/` is the recorded failure that broke the DOCKER BUILD once — `turbo prune web
 *     --docker` keeps a different tree than the one every local gate sees.
 *   - This package CAN import the seed as values, which removes every pattern-matching hazard on
 *     that side: no slice, no anchor, no comment blindness, 230 entries exactly as declared.
 *
 * With codes, descriptions and scope pinned equal, "a permission reaches the seed and not the
 * fixture" is no longer possible, so the Arabic-coverage guard one hop away now fails for a code
 * added here. Proven by planting at the SEED and watching this file die.
 *
 * ## What this guard deliberately does NOT assert
 *
 * The `roles` grid. The fixture's ROLE_PERMISSIONS is generated from the DATABASE's grants, not from
 * the seed's `roles` arrays, and those differ legitimately — the seed upserts and never revokes, and
 * an office's own custom roles are excluded from the fixture by design. `npm run
 * db:fixture:permissions:check` is the gate for that half and it compares against the live grid,
 * which is the right subject for a grant. This file is about the CATALOGUE: which codes exist, and
 * what each one says.
 */

const REPO = path.join(__dirname, "..", "..", "..");
const FIXTURE = path.join(
  REPO,
  "apps",
  "web",
  "e2e",
  "fixtures",
  "role-permissions.ts",
);

/**
 * How few entries would mean the matcher has stopped matching rather than the catalogue having
 * shrunk. Rule 12: a completeness predicate must assert the PRESENCE of what it waits for, never the
 * absence of what it fears — two empty sets are equal, so parity alone passes vacuously.
 */
const FIXTURE_FLOOR = 200;

type Entry = { code: string; description: string; scope: "OFFICE" | "PLATFORM" };

/**
 * Reads the fixture's `PERMISSION_CATALOGUE` as text.
 *
 * Anchored on the `export const PERMISSION_CATALOGUE` DECLARATION and bounded by the `];` that
 * closes it, so a later array in the same file cannot extend the slice, and a rename makes this
 * fail BY NAME instead of silently reading nothing. The generator emits one object per line, which
 * is why a per-entry regex is exact here rather than hopeful.
 */
function readFixture(): Entry[] {
  const text = fs.readFileSync(FIXTURE, "utf8");
  const declaration = /export const PERMISSION_CATALOGUE[^=]*=\s*\[/.exec(text);
  expect(
    declaration,
    `'export const PERMISSION_CATALOGUE … = [' not found in ${FIXTURE} — it was renamed or restructured, so this guard is now BLIND. Re-point it; do not delete it.`,
  ).not.toBeNull();
  const start = declaration!.index + declaration![0].length;
  const end = text.indexOf("\n];", start);
  expect(
    end,
    `the '];' closing PERMISSION_CATALOGUE not found in ${FIXTURE}`,
  ).toBeGreaterThan(start);
  const slice = text.slice(start, end);
  const pattern =
    /\{ code: '([a-z0-9.-]+)', module: '[a-z0-9.-]+', description: "((?:[^"\\]|\\.)*)", scope: '(OFFICE|PLATFORM)' \}/g;
  return [...slice.matchAll(pattern)].map((m) => ({
    code: m[1],
    description: m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
    scope: m[3] as "OFFICE" | "PLATFORM",
  }));
}

const seed: Entry[] = PERMISSIONS.map((p) => ({
  code: p.code,
  description: p.description,
  scope: p.scope ?? "OFFICE",
}));

describe("permission catalogue — the seed and the web e2e fixture are the same catalogue", () => {
  const fixture = readFixture();

  it("reads a plausible number of entries from the fixture (the matcher still matches)", () => {
    // Without this, a changed template makes the fixture read [] and every assertion below becomes
    // a comparison of one empty set with another.
    expect(fixture.length).toBeGreaterThan(FIXTURE_FLOOR);
    expect(seed.length).toBeGreaterThan(FIXTURE_FLOOR);
  });

  it("has every SEED code in the fixture — so a new permission cannot skip the Arabic guard", () => {
    const inFixture = new Set(fixture.map((e) => e.code));
    const missing = seed.map((e) => e.code).filter((code) => !inFixture.has(code));
    expect(
      missing,
      `These codes are in the seed and NOT in ${path.relative(REPO, FIXTURE)}. The coverage guard in apps/web reads that file, so each of these ships with no Arabic description and nothing fails. Seed db-test and regenerate: npm run db:test:seed && npm run db:fixture:permissions`,
    ).toEqual([]);
  });

  it("has no fixture code the seed does not declare", () => {
    const inSeed = new Set(seed.map((e) => e.code));
    const extra = fixture.map((e) => e.code).filter((code) => !inSeed.has(code));
    expect(
      extra,
      `These codes are in the fixture and not in the seed — either the seed entry was deleted without regenerating, or a grant was made by hand on the database the fixture was generated from.`,
    ).toEqual([]);
  });

  it("agrees on the English description of every code", () => {
    const byCode = new Map(fixture.map((e) => [e.code, e]));
    const differing = seed
      .filter((e) => byCode.has(e.code) && byCode.get(e.code)!.description !== e.description)
      .map((e) => e.code);
    // This is the dimension that was actually stale: `retention.archive.retrieve` carried the
    // superseded "exactly two bases" sentence in the fixture for three days after the seed was
    // corrected to four, and the fixture's copy is what the descriptions guard reads.
    expect(differing, `Descriptions differ between the seed and the fixture for these codes.`).toEqual([]);
  });

  it("agrees on the scope of every code, so the matrix never offers a PLATFORM code", () => {
    const byCode = new Map(fixture.map((e) => [e.code, e]));
    const differing = seed
      .filter((e) => byCode.has(e.code) && byCode.get(e.code)!.scope !== e.scope)
      .map((e) => `${e.code} (seed ${e.scope})`);
    expect(differing, `Scope differs between the seed and the fixture.`).toEqual([]);
  });

  it("carries at least one PLATFORM code, so the scope assertion above is not vacuous", () => {
    expect(fixture.filter((e) => e.scope === "PLATFORM").length).toBeGreaterThan(0);
  });
});
