import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * The first tests this app has ever had for dark mode.
 *
 * Until the toggle landed, dark was reachable only by operating-system
 * setting, Playwright runs light, and CLAUDE.md has carried "dark theme is
 * computed, never measured" since the accessibility pass. These are
 * deliberately lean: enough to prove the MECHANISM end to end — the attribute
 * flips, the choice survives a reload, an explicit light choice beats a dark
 * OS — plus a sanity check that the surfaces the border sweep touched are
 * actually legible once dark is on.
 *
 * Not a parallel dark-mode suite. The point is that the switch works and
 * nothing disappears, not per-screen visual coverage.
 */

const ROLES = ["BRANCH_DEPARTMENT_MANAGER"];

const ME = {
  id: "user-mgr",
  email: "manager@ibms.test",
  fullName: "Branch Manager",
  languagePreference: "EN",
  roles: ROLES,
  permissions: permissionsForRoles(ROLES),
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  department: { name: "Claims", nameAr: "المطالبات" },
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function openApp(page: Page, path = "/leads") {
  await page.route("http://localhost:4000/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "token" } }),
  );
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, json: ME }));
  await page.goto(path);
}

const themeAttr = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));

/** The colour the browser actually painted, not the token we hoped for. */
async function computed(page: Page, selector: string, property: string) {
  return page.evaluate(
    ([sel, prop]) => getComputedStyle(document.querySelector(sel)!).getPropertyValue(prop),
    [selector, property] as const,
  );
}

test("no stored preference means no attribute — the OS stays in charge", async ({ page }) => {
  await openApp(page);
  // The absence of the attribute is load-bearing: the media query is guarded
  // as :root:not([data-theme="light"]), so absence is what lets the OS decide.
  expect(await themeAttr(page)).toBeNull();
});

test("choosing dark flips the attribute and repaints the page", async ({ page }) => {
  await openApp(page);
  const before = await computed(page, "body", "background-color");

  await page.getByRole("button", { name: "Dark" }).click();

  expect(await themeAttr(page)).toBe("dark");
  const after = await computed(page, "body", "background-color");
  expect(after).not.toBe(before);
});

test("the choice survives a full reload", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Dark" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("ibms.theme")))
    .toBe("dark");

  await page.reload();
  // Adopted through useSyncExternalStore, so this also proves the SSR
  // snapshot and the client snapshot reconcile without a hydration error.
  expect(await themeAttr(page)).toBe("dark");
  await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
});

test("an explicit light choice beats an operating system set to dark", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();
  await openApp(page);

  // Without the :root:not([data-theme="light"]) guard on the media query, this
  // is the case that silently does nothing.
  await page.getByRole("button", { name: "Light" }).click();
  expect(await themeAttr(page)).toBe("light");

  const cardBg = await computed(page, "body", "background-color");
  // The light page surface is #f4f6fa; anything near-black means the media
  // query is still winning.
  expect(cardBg).toBe("rgb(244, 246, 250)");
  await ctx.close();
});

test("an OS set to dark renders dark with no stored preference at all", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();
  await openApp(page);

  expect(await themeAttr(page)).toBeNull();
  expect(await computed(page, "body", "background-color")).toBe("rgb(22, 29, 38)");
  await ctx.close();
});

test("text stays legible in dark — no ink left on a surface it cannot be read on", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("button", { name: "Dark" }).click();

  const ink = await computed(page, "body", "color");
  const ground = await computed(page, "body", "background-color");
  // The light-mode ink is #26303e; if the tokens had not swapped, body text
  // would still be near-black on a near-black page.
  expect(ink).toBe("rgb(232, 236, 242)");
  expect(ground).toBe("rgb(22, 29, 38)");
});

test("the border tokens the sweep moved onto actually change with the theme", async ({ page }) => {
  await openApp(page);

  // Read the TOKENS rather than hunt for a bordered element: which elements
  // are on screen depends on fixture data, and the claim being tested is about
  // the tokens the sweep pointed 144 declarations at. Before the sweep those
  // declarations were the literals #e5e7eb and #d1d5db, which report the same
  // value in both themes — a light grey rule on a dark page.
  const read = (name: string) =>
    page.evaluate(
      (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
      name,
    );

  expect(await read("--border-subtle")).toBe("#e6e9ef");
  expect(await read("--border-default")).toBe("#dadee4");

  await page.getByRole("button", { name: "Dark" }).click();

  expect(await read("--border-subtle")).toBe("#26303d");
  expect(await read("--border-default")).toBe("#313d4c");
});

test("the toggle is reachable and labelled in Arabic too", async ({ page }) => {
  // Through the ACCOUNT preference, not the localStorage guess: LanguageProvider
  // treats the stored value as a pre-auth hint and lets /auth/me win once it
  // resolves, so a mock that still says EN would flip the UI back.
  await page.route("http://localhost:4000/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, json: { ...ME, languagePreference: "AR" } }),
  );
  await page.goto("/leads");

  await page.getByRole("button", { name: "داكن" }).click();
  expect(await themeAttr(page)).toBe("dark");
  await expect(page.getByRole("group", { name: "المظهر" })).toBeVisible();
});
