import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PERMISSIONS } from "./permissions";

/*
 * A PERMISSION CODE THAT NOTHING READS IS A CHECKBOX THAT REMOVES NOTHING.
 *
 * Four-action Phase 1 refused to DECLARE `document.update`, `document.deactivate` and
 * `risk-profile.deactivate` on exactly this ground: "a code nothing can exercise is worse than an
 * umbrella", because it reads as a capability that exists. This guard is the other half of that
 * decision — the one Phase 1 could not make, because it was about codes already in the catalogue.
 *
 * The measurement that produced it: of 211 codes, 12 sit on no route guard. Nine of those are read
 * by a SERVICE — the `.all-owners.read` family widens a visibility filter, `customer.national-id.reveal`
 * gates one field of one response, `access-recertification.review.routine` tiers a reviewer pool — which
 * is enforcement, just not at the route. THREE were read nowhere in the application at all.
 *
 * That is not a cosmetic defect. `refund.raise` is described as "the maker side" of a maker/checker
 * pair; an administrator who unchecks it on the Role matrix believes they have taken away the ability
 * to raise a refund. They have not: a refund is created inside
 * `POST /endorsements/:id/calculate-adjustment`, gated by `endorsement.apply`. The segregation itself
 * holds — `assertDifferentActors` plus the CHECK constraint still refuse a self-approval — so nothing
 * is exploitable. What is wrong is that the screen makes a promise the code does not keep.
 *
 * The codes are NOT deleted. `RolePermission` rows are the record of what an office once granted, the
 * same reason Phase 3 gave `Role` no DELETE; and the house rule for a capability that is not ready is
 * to keep it visible and SAY so, not to vanish it (the mode screen's COMBINED option is the precedent).
 * So the fix is that each one's description — the sentence the Role matrix actually renders — states
 * that it is not yet enforced, and this guard keeps that list honest.
 */

/** Runtime application code. A code enforced anywhere appears here as a string literal. */
const ROOTS = ["apps/api/src", "apps/web/app", "apps/web/lib", "apps/web/components"];

/**
 * The codes nothing reads, each with the reason and what it would take to make it real.
 *
 * Checked in BOTH directions below, which is the property that stops it rotting: an entry that gets
 * wired up must leave this list, and a code that stops being read must join it.
 */
const UNENFORCED: Record<string, string> = {
  "claim.delete":
    "No route deletes a claim, and the 'logged privileged override' its description used to promise does not exist anywhere. The capability this product actually has is `claim.discard` — withdraw a claim raised in error, keeping the row (`docs/discard.md`). Making this real would mean deciding that a claim may be destroyed, which is a product decision nobody has taken.",
  "refund.raise":
    "A refund is created inside POST /endorsements/:id/calculate-adjustment, gated by `endorsement.apply`, because the refund and its commission reversal must move together. This code is reserved for a standalone refund-raise endpoint (an overpayment not tied to an endorsement) that does not exist.",
  "commission-reversal.create":
    "Created in the same transaction as the refund above, under the same `endorsement.apply` gate, for the same reason: the two figures cannot be raised independently.",
};

/**
 * Files that MENTION every code by name and enforce none of them.
 *
 * A display map keyed by permission code quotes all of its codes as object keys, so a grep for
 * `'<code>'` finds every one and the whole catalogue looks enforced. That is the opposite of what
 * this guard measures, and it would hide exactly the defect it exists to catch.
 *
 *   `permission-descriptions.ts`  the lookup for the line UNDER each checkbox.
 *   `permission-names.ts`         🔴 OWNER DECISION 127, message 50 — the 196 ratified Arabic
 *                                 NAMES, keyed by code. It is a dictionary of what to RENDER in
 *                                 place of the code; nothing in it decides what anybody may do.
 *                                 Without this entry, `refund.raise` and
 *                                 `commission-reversal.create` read as enforced the moment the
 *                                 names shipped — which is how CI found it.
 *
 * ⛔ This list is for files that are definitionally about DISPLAY. A service that reads a code to
 * decide something belongs in the walk however inconvenient, and adding a file here to make a
 * build pass would turn the guard off for every code that file happens to name.
 */
const DISPLAY_ONLY_FILES: Record<string, string> = {
  "permission-descriptions.ts": "apps/web/lib/admin/permission-descriptions.ts",
  "permission-names.ts": "apps/web/lib/admin/permission-names.ts",
};

/** Every code the application actually reads, from the source rather than from a second list. */
function enforcedCodes(): Set<string> {
  const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
  const sources: string[] = [];
  for (const root of ROOTS) {
    const abs = path.join(repoRoot, root);
    expect(fs.existsSync(abs), `${root} does not exist — this guard is reading nothing`).toBe(true);
    walk(abs, sources);
  }
  // A sanity floor: if the walk silently found almost nothing, every code would look unenforced and
  // this spec would fail loudly — but a guard that can only fail loudly for the wrong reason is worth
  // one assertion that says so.
  expect(sources.length).toBeGreaterThan(500);

  const found = new Set<string>();
  const haystack = sources.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  for (const permission of PERMISSIONS) {
    if (haystack.includes(`'${permission.code}'`) || haystack.includes(`"${permission.code}"`)) {
      found.add(permission.code);
    }
  }
  return found;
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    // A spec naming a code is not the application enforcing it — and the e2e permission fixture is a
    // generated MIRROR of this very catalogue, so counting it would make every code look enforced.
    if (/\.(spec|test)\.tsx?$/.test(entry.name)) continue;
    if (full.includes(`${path.sep}fixtures${path.sep}`)) continue;
    if (entry.name in DISPLAY_ONLY_FILES) continue;
    out.push(full);
  }
}

describe("permission catalogue — every code the screen offers is a code something reads", () => {
  const enforced = enforcedCodes();

  it("has no code that the application never reads, outside the declared list", () => {
    const unread = PERMISSIONS.map((p) => p.code)
      .filter((code) => !enforced.has(code))
      .filter((code) => !(code in UNENFORCED))
      .sort();
    expect(unread).toEqual([]);
  });

  it("declares nothing as unenforced that the application does in fact read", () => {
    // The direction that rots. Without it, wiring up `refund.raise` would leave a description on the
    // Role matrix still telling the administrator it does nothing.
    const nowEnforced = Object.keys(UNENFORCED).filter((code) => enforced.has(code)).sort();
    expect(nowEnforced).toEqual([]);
  });

  /*
   * THE DIRECTION THE EXCLUSION LIST ROTS IN, added with `permission-names.ts` in message 50.
   *
   * `walk` skips by BASENAME, so an entry here silences that name anywhere under the four roots —
   * and if the file is renamed or deleted the entry survives, silently ready to skip some future
   * file that happens to take the name. Each one must therefore still exist where it says it does.
   */
  it("excludes only display files that still exist, at the path each entry names", () => {
    const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
    for (const [basename, relative] of Object.entries(DISPLAY_ONLY_FILES)) {
      const abs = path.join(repoRoot, relative);
      expect(
        fs.existsSync(abs),
        `DISPLAY_ONLY_FILES names ${relative} and it is not there — delete the entry in the SAME ` +
          `commit, or this guard stays switched off for every code that file used to mention`,
      ).toBe(true);
      expect(path.basename(relative), `${relative} does not end in ${basename}`).toBe(basename);
    }
  });

  it("declares nothing as unenforced that is not in the catalogue at all", () => {
    const codes = new Set(PERMISSIONS.map((p) => p.code));
    expect(Object.keys(UNENFORCED).filter((code) => !codes.has(code))).toEqual([]);
  });

  it("gives every unenforced code a reason of real length", () => {
    for (const [code, reason] of Object.entries(UNENFORCED)) {
      expect(reason.length, `${code} needs a reason, not a placeholder`).toBeGreaterThan(80);
    }
  });

  it("says so in the description the Role matrix renders, not only in this file", () => {
    // The whole point. A reason recorded in a spec is invisible to the person holding the checkbox.
    for (const code of Object.keys(UNENFORCED)) {
      const permission = PERMISSIONS.find((p) => p.code === code);
      expect(permission, `${code} is not in the catalogue`).toBeDefined();
      expect(
        permission!.description.toLowerCase(),
        `${code}'s description must tell the reader it is not yet enforced`,
      ).toContain("not yet enforced");
    }
  });
});
