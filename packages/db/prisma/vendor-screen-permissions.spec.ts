import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/*
 * THE VENDOR SCREEN'S PERMISSION CODES, COMPARED AGAINST THE ROUTES THEY DRIVE.
 *
 * `/vendors/[id]` checked NO permission at all until 2026-11-06 (module 0-c batch 6): eight
 * controls, including "terminate contract" and the DPO's own approval of a data-processing
 * agreement, rendered for anybody who could open the page and failed with a 403 when pressed.
 *
 * ## WHY A TEST AND NOT A TYPE
 *
 * `hasPermission(user, code)` takes a plain `string`. Every wrong code therefore TYPECHECKS, and it
 * fails CLOSED — the control vanishes for the person who should have it, silently, and the screen
 * looks correct to everybody who lacks the permission anyway. No compiler can see it. This is the
 * argument `recommendation-approval-permissions.spec.ts` makes for itself, and this file is its
 * sibling; both sit in `packages/db` because it is the only place that can see `apps/web` and
 * `apps/api` at once (`turbo prune web --docker` keeps only web's workspace dependencies, so a spec
 * in `apps/web` reading an `apps/api` path typechecks on a laptop and fails inside the image).
 *
 * ## WHAT IT ASSERTS
 *
 * Every code the screen binds must be a code one of its routes actually enforces, and the three
 * must stay DISTINCT. The distinctness matters more than it looks: `dpa.approve` is the DPO's code
 * and nobody else's, so collapsing it into the vendor-management code would hand the DPO's half of
 * a maker/checker pair to whoever manages vendors — the defect row 12 names, arriving through a
 * convenience rather than a mistake.
 */

const REPO = path.join(__dirname, "..", "..", "..");

const SCREEN = path.join(
  REPO,
  "apps",
  "web",
  "app",
  "(app)",
  "vendors",
  "[id]",
  "page.tsx",
);
const VENDOR_CONTROLLER = path.join(
  REPO,
  "apps",
  "api",
  "src",
  "modules",
  "supporting-operations",
  "vendor.controller.ts",
);
const DPA_CONTROLLER = path.join(
  REPO,
  "apps",
  "api",
  "src",
  "modules",
  "supporting-operations",
  "data-processing-agreement.controller.ts",
);

function enforcedCodes(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  return [...text.matchAll(/@RequirePermissions\(\s*'([^']+)'/g)].map(
    (m) => m[1],
  );
}

function boundCodes(): string[] {
  const text = fs.readFileSync(SCREEN, "utf8");
  // Only real bindings — `hasPermission(user, "x")`. A code NAMED in a comment is not a binding,
  // and this guard's own prose names all three of them, so anchoring on the call is the difference
  // between reading the screen and reading the documentation about the screen. A sibling guard in
  // this directory was fooled by exactly that on 2026-11-06 and had to be re-anchored.
  return [...text.matchAll(/hasPermission\(\s*user,\s*"([^"]+)"\s*\)/g)].map(
    (m) => m[1],
  );
}

describe("/vendors/[id] — the screen's permission codes are the routes' own", () => {
  const enforced = new Set([
    ...enforcedCodes(VENDOR_CONTROLLER),
    ...enforcedCodes(DPA_CONTROLLER),
  ]);
  const bound = boundCodes();

  it("reads codes from BOTH sides (the patterns still match)", () => {
    // Non-vacuity. Without this, a refactor that breaks either pattern leaves both sides empty and
    // every assertion below passes while the guard sees nothing.
    expect(enforced.size).toBeGreaterThan(2);
    expect(bound.length).toBeGreaterThan(2);
  });

  it("binds only codes a vendor route actually enforces", () => {
    for (const code of bound) {
      expect(
        [...enforced],
        `the screen gates a control on "${code}", which no vendor or DPA route enforces — a wrong code FAILS CLOSED, hiding the control from the person who should have it`,
      ).toContain(code);
    }
  });

  it("keeps the DPO's approval code distinct from the vendor-management one", () => {
    expect(bound).toContain("dpa.approve");
    expect(bound).toContain("vendor.update");
    expect(bound).toContain("vendor.deactivate");
    // Three different codes, not one reused three times: `dpa.approve` gates the DPO half of a
    // maker/checker pair and must never be satisfied by holding `vendor.update`.
    expect(new Set(bound).size).toBe(3);
  });

  it("gates the DPO approval on dpa.approve — the code that route enforces, not vendor.update", () => {
    // Pinned by name rather than by count, because this is the one pairing where the convenient
    // answer and the correct answer differ.
    expect(enforcedCodes(DPA_CONTROLLER)).toContain("dpa.approve");
  });
});
