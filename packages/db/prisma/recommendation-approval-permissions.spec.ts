import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/*
 * THE SCREEN'S CONTROL AND THE ENDPOINT'S GUARD MUST NAME THE SAME PERMISSION.
 *
 * ## The defect this exists for, which was live and not theoretical
 *
 * `/opportunities/[id]` rendered the recommendation section with ONE prop, `isManager`, bound to
 * `quotation.negotiate`. The grant table is what makes that fatal rather than untidy:
 *
 *     quotation.negotiate              -> PLACEMENT_TECHNICAL_OFFICER
 *     opportunity.set-target-threshold -> BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT
 *     recommendation.approve           -> BRANCH_DEPARTMENT_MANAGER
 *
 * So the placement officer SAW the threshold field and the Approve button and was answered 403 by
 * both endpoints; the manager — who holds both permissions — saw NEITHER control. An over-threshold
 * recommendation could therefore be neither approved nor sent BY ANYBODY, which is a workflow
 * stopped dead in the placement stage with nothing failing anywhere.
 *
 * ## Why a compiler cannot catch it, which is the whole reason this file exists
 *
 * `hasPermission(user, code: string)` takes a PLAIN STRING. There is no union, so there is no
 * spelling the compiler rejects: a typo, a stale code, or an entirely unrelated permission all
 * typecheck, and every one of them FAILS CLOSED — the control simply does not render. That is the
 * silent direction. Nobody gets an error to chase; the button is just absent, and the person who
 * needed it assumes they are not allowed.
 *
 * Widening the single flag could not have fixed it either, because the two controls are guarded by
 * two different endpoints granted to two different sets of roles — EXEC holds the threshold
 * permission and not the approval. One boolean cannot carry that.
 *
 * ## What this asserts, and why it reads the API rather than a list
 *
 * A hand-written list of expected codes here would be a THIRD copy to keep in step, and the defect
 * being guarded is precisely a copy drifting. So the API's own `@RequirePermissions` decorator is
 * the authority: this reads the decorator on each route and requires the web's binding for that
 * control to name the same code. Re-point either side alone and this fails.
 *
 * It also requires both codes to exist in the seeded catalogue, because a control bound to a code
 * nobody is ever granted is the same invisible failure by another route.
 *
 * ## Why in `packages/db`, which owns none of the three files
 *
 * Because it is the only package that can SEE all of them. A spec in `apps/web` reading an
 * `apps/api` path typechecks on a laptop and fails inside the image — `turbo prune web --docker`
 * keeps only web's workspace dependencies, and `apps/api` is not one. The parity guards already in
 * this directory sit here for exactly that reason.
 */

const REPO = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  const full = path.join(REPO, rel);
  const text = fs.readFileSync(full, "utf8");
  // NON-VACUITY: an empty or moved file would make every regex below match nothing, and a guard
  // that silently stops looking reports the same clean pass as a correct tree.
  expect(text.length, `${rel} is empty`).toBeGreaterThan(200);
  return text;
}

const OPPORTUNITY_CONTROLLER =
  "apps/api/src/modules/opportunity/opportunity.controller.ts";
const RECOMMENDATION_CONTROLLER =
  "apps/api/src/modules/recommendation/recommendation.controller.ts";
const SCREEN = "apps/web/app/(app)/opportunities/[id]/page.tsx";
const CATALOGUE = "packages/db/prisma/seed-data/permissions.ts";

/**
 * The permission enforced on the route whose HTTP path contains `pathFragment`.
 *
 * Reads the LAST `@RequirePermissions` appearing before the route decorator, which is how Nest
 * applies them — a decorator belongs to the handler beneath it. Deliberately not a whole-file
 * search for the code: that would pass whenever the code appears anywhere in the controller,
 * including on a different route, which is the exact class of mistake being guarded.
 */
function enforcedPermission(source: string, pathFragment: string): string {
  const routeIndex = source.indexOf(pathFragment);
  expect(
    routeIndex,
    `no route containing "${pathFragment}" — it was renamed or removed`,
  ).toBeGreaterThan(-1);

  const before = source.slice(0, routeIndex);
  const matches = [...before.matchAll(/@RequirePermissions\('([^']+)'\)/g)];
  expect(
    matches.length,
    `no @RequirePermissions precedes the route containing "${pathFragment}"`,
  ).toBeGreaterThan(0);

  return matches[matches.length - 1]![1]!;
}

/** The permission code a named `hasPermission` binding on the screen reads. */
function boundPermission(source: string, variable: string): string {
  const m = new RegExp(
    `const ${variable} = hasPermission\\(user, '([^']+)'\\)`,
  ).exec(source);
  expect(
    m,
    `the screen has no "const ${variable} = hasPermission(user, '...')" binding`,
  ).not.toBeNull();
  return m![1]!;
}

/** Every role name granted a code in the seeded catalogue. */
function grantedRoles(catalogue: string, code: string): string[] {
  const entry = new RegExp(
    `code:\\s*"${code.replace(/\./g, "\\.")}"[\\s\\S]{0,600}?roles:\\s*\\[([^\\]]*)\\]`,
  ).exec(catalogue);
  expect(entry, `"${code}" is not in the seeded permission catalogue`).not.toBeNull();
  return entry![1]!
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

describe("the recommendation controls name the permissions their endpoints enforce", () => {
  /**
   * Each row: the control, the API route that control calls, and the screen variable bound to it.
   * The expected CODE is deliberately absent — it comes from the API, which is the authority.
   */
  const CONTROLS = [
    {
      control: "the target-premium-threshold field",
      controller: OPPORTUNITY_CONTROLLER,
      routeFragment: "':id/target-premium-threshold'",
      variable: "canSetThreshold",
    },
    {
      control: "the Approve button",
      controller: RECOMMENDATION_CONTROLLER,
      routeFragment: "':id/approve'",
      variable: "canApproveRecommendation",
    },
  ] as const;

  it.each(CONTROLS)(
    "$control is bound to the code its endpoint guards",
    ({ controller, routeFragment, variable }) => {
      const enforced = enforcedPermission(read(controller), routeFragment);
      const bound = boundPermission(read(SCREEN), variable);
      expect(bound).toBe(enforced);
    },
  );

  it.each(CONTROLS)(
    "$control's permission is in the seeded catalogue and is granted to somebody",
    ({ controller, routeFragment }) => {
      const enforced = enforcedPermission(read(controller), routeFragment);
      const roles = grantedRoles(read(CATALOGUE), enforced);
      // A control bound to a code nobody holds is invisible to every user, which is the same
      // failure as binding the wrong code.
      expect(roles.length).toBeGreaterThan(0);
    },
  );

  it("the two controls do NOT share one permission, which is why they are two props", () => {
    const threshold = enforcedPermission(
      read(OPPORTUNITY_CONTROLLER),
      "':id/target-premium-threshold'",
    );
    const approve = enforcedPermission(
      read(RECOMMENDATION_CONTROLLER),
      "':id/approve'",
    );
    expect(threshold).not.toBe(approve);

    // And they are granted to DIFFERENT role sets, which is what makes a single boolean
    // structurally unable to express them. If this ever stops being true the two props may be
    // merged — but that is a decision, not a cleanup, so it should fail here first.
    const catalogue = read(CATALOGUE);
    expect(grantedRoles(catalogue, threshold)).not.toEqual(
      grantedRoles(catalogue, approve),
    );
  });

  it("the screen does not read quotation.negotiate, whose only control is on another screen", () => {
    // `quotation.negotiate` guards POST /quotations/:id/revise, and the control that calls it lives
    // in QuotationsSection on /rfqs/[id]. Reading it here is what the defect was; a reader who finds
    // it back on this screen should assume the regression rather than a new requirement.
    const screen = read(SCREEN).replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      (c) => c.replace(/\S/g, " "),
    );
    expect(screen).not.toContain("quotation.negotiate");
  });
});
