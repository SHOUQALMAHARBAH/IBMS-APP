import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * The top bar: wordmark at the leading edge, controls at the trailing edge.
 *
 * The language toggle's own behaviour is covered by language-switcher.spec.ts,
 * which was written against the sidebar and passes UNCHANGED now that the
 * buttons live here — every one of its locators is by accessible name rather
 * than by container. What this file adds is what is new: the landmark, the
 * profile block, the inert notifications slot, and the shell restructure.
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

async function openApp(page: Page, me: Record<string, unknown> = ME) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "token" } }),
  );
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, json: me }));
  await page.route("http://localhost:4000/leads**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto("/leads");
}

function navbar(page: Page) {
  return page.getByRole("navigation", { name: /^(Account and settings|الحساب والإعدادات)$/ });
}

test("the navbar is its own landmark, distinct from the sidebar", async ({ page }) => {
  await openApp(page);
  // Two <nav> landmarks now exist. Each needs its own accessible name or
  // neither a screen-reader user nor a test can tell them apart.
  await expect(navbar(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(2);
});

test("the wordmark sits in the navbar and no longer in the sidebar", async ({ page }) => {
  await openApp(page);
  await expect(navbar(page).getByRole("link", { name: "IBMS" })).toBeVisible();
  // The whole point of moving it: one brand mark, not two.
  await expect(page.getByRole("link", { name: "IBMS" })).toHaveCount(1);
});

test("the profile block shows the name and the department under it", async ({ page }) => {
  await openApp(page);
  const bar = navbar(page);
  await expect(bar.getByText("Branch Manager")).toBeVisible();
  await expect(bar.getByText("Claims", { exact: true })).toBeVisible();
});

test("the department renders in Arabic when the user reads Arabic", async ({ page }) => {
  await openApp(page, { ...ME, languagePreference: "AR" });
  // nameAr, not the English name — the endpoint returns both precisely so the
  // client can pick without the server knowing the render language.
  await expect(navbar(page).getByText("المطالبات")).toBeVisible();
});

test("a user with no department shows their name and nothing under it", async ({ page }) => {
  // Signup grants no department; only provisioning does. The line is absent,
  // not an empty row or the word "null".
  await openApp(page, { ...ME, department: null });
  const bar = navbar(page);
  await expect(bar.getByText("Branch Manager")).toBeVisible();
  await expect(bar.getByText("Claims", { exact: true })).toHaveCount(0);
});

test("the avatar shows initials, and handles an Arabic name", async ({ page }) => {
  await openApp(page);
  await expect(navbar(page).getByText("BM", { exact: true })).toBeVisible();

  await openApp(page, { ...ME, fullName: "أحمد الهاشمي", languagePreference: "AR" });
  // A [A-Z] match would render an empty circle here.
  await expect(navbar(page).getByText("أا", { exact: true })).toBeVisible();
});

test("the profile menu opens with Change password and Log out, and closes on Escape", async ({
  page,
}) => {
  await openApp(page);
  const bar = navbar(page);
  const changePassword = bar.getByRole("link", { name: "Change password" });

  await expect(changePassword).toBeHidden();
  await bar.locator("summary").click();

  await expect(changePassword).toBeVisible();
  await expect(changePassword).toHaveAttribute("href", "/settings/security");
  await expect(bar.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(changePassword).toBeHidden();
});

test("the profile menu closes when the pointer goes elsewhere", async ({ page }) => {
  await openApp(page);
  const bar = navbar(page);
  await bar.locator("summary").click();
  await expect(bar.getByRole("link", { name: "Change password" })).toBeVisible();

  await page.getByRole("heading").first().click();
  await expect(bar.getByRole("link", { name: "Change password" })).toBeHidden();
});

test("the notifications slot holds a control with a real accessible name", async ({ page }) => {
  await openApp(page);
  // THIS TEST ASSERTED THE OPPOSITE, AND PASSED, FOR 107 COMMITS.
  //
  // Written at c5fafb2 the claim was true: the slot was a decorative `<span aria-hidden>`, kept out
  // of the accessibility tree on purpose, because an empty button takes focus, shows a focus ring and
  // does nothing — which reads as broken. Thirteen commits later 9bd396d built the bell and replaced
  // that span (its own header says so). The claim became false and nothing failed, because
  // `toHaveCount(0)` is satisfied on its FIRST poll: the button had not rendered yet, so the
  // assertion passed before the page could contradict it. Anchoring the read is what surfaced it.
  //
  // The behaviour belongs to notifications.spec.ts (7 tests). What this spec still owns is the
  // navbar's own property: the slot is not an unnamed control.
  const bell = navbar(page).getByRole("button", { name: /notification/i });
  await expect(bell).toBeVisible();
  await expect(bell).toHaveAttribute("aria-expanded", "false");
});

test("the sidebar still starts below the navbar rather than under it", async ({ page }) => {
  await openApp(page);
  const barBox = await navbar(page).boundingBox();
  const sidebarBox = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
  if (!barBox || !sidebarBox) throw new Error("no bounding box");

  // sidebarStyle is sticky; with `top: 0` it would park underneath the bar.
  // Both offsets derive from NAVBAR_HEIGHT, and this is what proves they agree.
  expect(sidebarBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
});

test("the navbar screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await openApp(page);
  await navbar(page).locator("summary").click();

  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious).toEqual([]);
});
