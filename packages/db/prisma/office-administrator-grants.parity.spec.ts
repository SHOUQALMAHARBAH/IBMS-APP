import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "./seed-data/permissions";

/**
 * MODULE 0-ب ITEM (d) — THE OFFICE ADMINISTRATOR'S GRANT SET IS DECLARED IN TWO PLACES, SO IT IS
 * GUARDED IN BOTH DIRECTIONS.
 *
 * ## WHY THERE ARE TWO
 *
 * `prisma/seed-data/permissions.ts` names the role per code, in each entry's `roles` array — that is
 * what the SEED writes when a database is built. `apps/api/src/modules/provider/
 * office-administrator-grants.ts` declares the same set as a list — that is what a REGISTRATION
 * writes when the provider registers a new office.
 *
 * They are not one file for a structural reason rather than a preference. `prisma/seed-data/` sits
 * outside `@ibms/db`'s export surface, so `apps/api` cannot import it — `role-scope.inventory.
 * spec.ts` already reads it off disk by path for exactly that reason. And `packages/db/
 * tsconfig.json` sets `rootDir: "src"`, so the reverse (`permissions.ts` importing a list from
 * `src/`) is the only single-home shape available and is recorded in `docs/deferred-register.md`
 * rather than done mid-item.
 *
 * ## WHY THIS FILE LIVES HERE
 *
 * `packages/db` is the ONLY place that can see both — the same reason `audit-action-parity.spec.ts`
 * lives beside it, and the same reason that guard was written at all. A parity check in `apps/api`
 * could not read the seed grid; one in the web could read neither.
 *
 * ## WHAT GOES WRONG WITHOUT IT
 *
 * Both directions are real and neither is loud:
 *
 *   * a code granted in the seed and missing from the api list — every office built by the seed has
 *     it, every office REGISTERED through the application does not. The second office is quietly
 *     less capable than the first, and the symptom arrives weeks later as "this button works in our
 *     other office".
 *   * a code in the api list and not in the seed — the reverse, and worse, because a registered
 *     office then holds something the seeded one does not and nobody decided that it should.
 */

const API_GRANTS_FILE = join(
  __dirname,
  "../../../apps/api/src/modules/provider/office-administrator-grants.ts",
);

const ROLE = "OFFICE_ADMINISTRATOR";

/** What the SEED grants: every catalogue entry whose `roles` array names the role. */
const seedGrants = PERMISSIONS.filter((p) => p.roles.includes(ROLE))
  .map((p) => p.code)
  .sort();

/**
 * What the API list declares. Parsed from the SOURCE rather than imported, because this package
 * cannot import from `apps/api` — the same path-read `role-scope.inventory.spec.ts` uses in the
 * other direction.
 *
 * The parse takes every single-quoted string inside the grant-groups object literal. That is
 * deliberately crude and is made safe by the non-vacuity floor below: a parser that stops matching
 * yields an EMPTY set, which would otherwise make every assertion here pass trivially.
 */
function parseApiGrants(source: string): string[] {
  const start = source.indexOf("export const OFFICE_ADMINISTRATOR_GRANT_GROUPS");
  const end = source.indexOf("} as const satisfies", start);
  if (start === -1 || end === -1) return [];
  const body = source.slice(start, end);
  const found = new Set<string>();
  for (const m of body.matchAll(/'([a-z0-9][a-z0-9.\-]*)'/g)) {
    found.add(m[1]);
  }
  return [...found].sort();
}

describe("the office administrator's grant set, declared in two places", () => {
  it("the api declaration is where this spec expects it", () => {
    // A renamed or moved file would otherwise make the parse return nothing and every assertion
    // below pass against an empty set.
    expect(
      existsSync(API_GRANTS_FILE),
      `${API_GRANTS_FILE} does not exist — if the declaration moved, repoint this spec rather than deleting it`,
    ).toBe(true);
  });

  it("neither side is empty — the floor that stops this whole file going vacuous", () => {
    const api = parseApiGrants(readFileSync(API_GRANTS_FILE, "utf8"));
    expect(
      seedGrants.length,
      "no catalogue entry grants OFFICE_ADMINISTRATOR — either the role name changed or the grid did",
    ).toBeGreaterThan(30);
    expect(
      api.length,
      "the api grant list parsed as empty — the parser stopped matching, and an empty set satisfies every equality below",
    ).toBeGreaterThan(30);
  });

  it("the two sides name EXACTLY the same codes", () => {
    /*
     * The SET, not the count. A count is satisfied by any 45 codes, including 45 where one was
     * swapped for another — which is the standing rule on this branch, and it has already caught
     * four instances.
     */
    const api = parseApiGrants(readFileSync(API_GRANTS_FILE, "utf8"));
    expect(
      api,
      "the seed grid and the registration grant list disagree. An office built by the seed and an office REGISTERED through the application would then have different administrators — fix whichever is wrong, deliberately, rather than making one follow the other",
    ).toEqual(seedGrants);
  });

  it("every code in the api list is a real permission in the catalogue", () => {
    /*
     * Equality with the seed grid already implies this today, and it is asserted separately because
     * the two answer different questions: this one survives the seed grid being wrong in the same
     * way, and it is what catches a typo'd code that would reach `setPermissions` as a grant of
     * nothing. A permission nobody can hold makes a screen unreachable by anyone.
     */
    const catalogue = new Set(PERMISSIONS.map((p) => p.code));
    const api = parseApiGrants(readFileSync(API_GRANTS_FILE, "utf8"));
    const unknown = api.filter((c) => !catalogue.has(c));
    expect(
      unknown,
      "these codes are declared for a new office's administrator and do not exist in the permission catalogue",
    ).toEqual([]);
  });

  it("grants NO code whose effect reaches outside the granting office", () => {
    /*
     * Module 0 item (j)'s boundary, applied to the one place that writes a brand-new office's grants.
     * A PLATFORM-scoped code may only be held by the provider — `setPermissions` refuses it and the
     * office matrix hides it — so one appearing in this list would be a grant the server then
     * refuses, i.e. a registration that half-fails.
     */
    const platform = new Set(
      PERMISSIONS.filter((p) => p.scope === "PLATFORM").map((p) => p.code),
    );
    expect(platform.size, "no PLATFORM code exists at all — item (j)'s scope column stopped being used, and this assertion now proves nothing").toBeGreaterThan(0);
    const api = parseApiGrants(readFileSync(API_GRANTS_FILE, "utf8"));
    expect(api.filter((c) => platform.has(c))).toEqual([]);
  });
});
