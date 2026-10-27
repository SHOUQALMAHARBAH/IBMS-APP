import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * THE SHELL MUST NOT WRITE TO THE CONSOLE.
 *
 * WHAT THIS FILE CANNOT DO, SAID FIRST, BECAUSE IT WAS WRITTEN TO DO IT AND CANNOT.
 *
 * It was written for the React warning the owner read on the theme toggle and the
 * language switch:
 *
 *     Updating a style property during rerender (borderColor) when a conflicting
 *     property is set (border) can lead to styling bugs.
 *
 * It PASSED ON THE BROKEN CODE — both tests, every transition, in both directions. Then
 * measured rather than explained away: that string appears in
 * `react-dom-client.development.js` and `react-dom-profiling.development.js` and in NO
 * production bundle (1, 1, and 0 everywhere else). Playwright here serves the `next build`
 * output, so this file is STRUCTURALLY INCAPABLE of seeing that class of warning. It is
 * not a weak test of it; it is a test of something that is not in the bundle.
 *
 * THE GUARD FOR THAT DEFECT IS `test/style-shorthand-conflict.test.ts`, a SOURCE guard,
 * and it fails by name on the exact pair she read. Read its header for why the source is
 * the only place the defect is observable — a rendered-appearance assertion cannot see it
 * either, because both style objects paint the same 1px solid border.
 *
 * WHAT THIS FILE IS STILL FOR, having been kept rather than deleted: a real runtime error
 * on the shell — a thrown exception, a failed hydration, a 500 surfacing as an unhandled
 * rejection — IS in the production bundle and IS caught here, on the two controls that sit
 * on all 106 screens. It collects every console error and warning rather than one pattern,
 * and the collection starts BEFORE the navigation, because a listener attached afterwards
 * misses the first paint, which is most of what a shell emits at all.
 */

const ME = {
  id: "user-1",
  email: "manager@ibms.test",
  fullName: "Branch Manager",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
  roles: ["BRANCH_DEPARTMENT_MANAGER"],
  permissions: permissionsForRoles(["BRANCH_DEPARTMENT_MANAGER"]),
};

/* The two `/auth/me` 401s before sign-in are expected and are the ONLY tolerated noise —
 * they are named rather than filtered by a loose pattern, because a broad filter is how a
 * real error gets swallowed by a test written to catch errors. */
function isExpected(text: string): boolean {
  return (
    text.includes("401") ||
    text.includes("Unauthorized") ||
    text.includes("Failed to load resource")
  );
}

async function collect(page: Page): Promise<string[]> {
  const noise: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    const text = msg.text();
    if (!isExpected(text)) noise.push(`${msg.type()}: ${text}`);
  });
  page.on("pageerror", (err) => noise.push(`pageerror: ${err.message}`));

  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, json: ME }),
  );
  await page.route("http://localhost:4000/leads**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  return noise;
}

test("switching the theme writes nothing to the console", async ({ page }) => {
  const noise = await collect(page);
  await page.goto("/leads");
  await expect(page.getByRole("navigation").first()).toBeVisible();

  // Every transition, both directions — the warning fires on the RERENDER that swaps the
  // two style objects, so a single click in one direction is not enough to provoke it.
  // Two buttons only — Light and Dark; there is no System control.
  for (const name of ["Dark", "Light", "Dark", "Light"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }

  expect(noise, `The shell wrote to the console:\n${noise.join("\n")}`).toEqual(
    [],
  );
});

test("switching the language writes nothing to the console", async ({
  page,
}) => {
  const noise = await collect(page);
  await page.goto("/leads");
  await expect(page.getByRole("navigation").first()).toBeVisible();

  // AR then EN then AR: the active/inactive pair swaps on each press, which is the
  // rerender the conflicting-property warning is about.
  for (const name of ["العربية", "English", "العربية"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }

  expect(noise, `The shell wrote to the console:\n${noise.join("\n")}`).toEqual(
    [],
  );
});
