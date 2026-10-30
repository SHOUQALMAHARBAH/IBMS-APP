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

/*
 * THE RAIL, by its own accessible name in EITHER language — the same shape `navbar()` above
 * already uses, and for a reason this batch re-learned by getting it wrong: the first version of
 * the two re-pointed tests below spelled `{ name: "Primary" }`, which matched until the test
 * switched the interface to Arabic and the landmark's own name became «التنقّل الرئيسي». The
 * element then "disappeared" — an element-not-found that reads exactly like a removed element and
 * is not one. Any locator that survives a language switch has to carry both names.
 */
function rail(page: Page) {
  return page.getByRole("navigation", { name: /^(Primary|التنقّل الرئيسي)$/ });
}

test("the navbar is its own landmark, distinct from the sidebar", async ({ page }) => {
  await openApp(page);
  // Two <nav> landmarks now exist. Each needs its own accessible name or
  // neither a screen-reader user nor a test can tell them apart.
  await expect(navbar(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(2);
});

/*
 * RE-POINTED BY THE DESIGN BATCH, and the reversal is the point rather than a detail.
 *
 * This test's own title was "the wordmark sits in the navbar and no longer in the sidebar", and it
 * asserted a link named `IBMS` in the navbar. Both halves moved:
 *
 *   * the product is **WASEET 360**; `IBMS` was the internal codename, and this was the THIRD
 *     user-visible occurrence of it — a hardcoded JSX literal, which is why an i18n grep for the
 *     codename found only two;
 *   * the brand went BACK to the rail, where the owner named its place ("the sidebar header") and
 *     where the approved reference screen puts it. The note that first moved it OUT of the rail was
 *     right about its reason — two brand marks stacked diagonally is what the alternative looks
 *     like — and what changed is that there is only one now.
 *
 * The property this test exists for is UNCHANGED and is still what it asserts: **one brand mark,
 * not two.** Only its home moved.
 */
test("the brand lockup sits in the sidebar header, and there is only one", async ({ page }) => {
  await openApp(page);
  await expect(rail(page).getByRole("link", { name: /وسيط 360/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /وسيط 360/ })).toHaveCount(1);
  // And nowhere does the codename reach a reader.
  await expect(page.getByRole("link", { name: "IBMS" })).toHaveCount(0);
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

  // THE ASSERTION STANDS AND ITS REASON MOVED. This used to read "sidebarStyle is sticky; with
  // `top: 0` it would park underneath the bar — both offsets derive from NAVBAR_HEIGHT, and this
  // is what proves they agree." Neither offset exists now: the shell is the viewport, the rail is
  // a full-height cell in a flex row below the bar, and it starts below the bar by FLOW rather
  // than by a sticky offset agreeing with a max-height. Kept rather than deleted, because the
  // property a reader cares about — the rail does not sit under the bar — is the same one.
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

/**
 * BATCH 1 ITEM 4, COMPLETED — the signed-in organization's own name in the shell.
 *
 * The item existed because the provider's name is the first thing the owner reads on screen one,
 * and the rename was half delivered: seeded, byte-asserted in CI, and rendered by nothing. Under
 * the standing rule a half-built decision is worse than an unbuilt one, because it reads as a
 * guarantee — so this asserts the render in BOTH languages and asserts the no-name case too.
 *
 * It reads under NO permission, deliberately: it rides on `me()` beside `organizationType`, which
 * every authenticated caller already receives. A code whose absence hides a person's own employer
 * from them is a gate nobody can fail.
 */
test("the shell renders the signed-in organization's name, by language", async ({
  page,
}) => {
  await openApp(page, {
    ...ME,
    organizationName: { en: "GO Global", ar: "جو جلوبال" },
  });
  // RE-POINTED: the organization's name went with the brand, into the rail's lockup as its
  // subtitle, so the office is named ONCE rather than twice. The property — resolved at RENDER by
  // the reader's language, never chosen by the server — is unchanged and is what the two
  // assertions below still test.
  const name = rail(page).locator("[data-organization-name]");
  await expect(name).toBeVisible();
  await expect(name).toHaveText("GO Global");

  // The Arabic form, resolved at RENDER rather than chosen by the server: picking server-side pins
  // the language to whatever `me()` was fetched under.
  await navbar(page)
    .getByRole("button", { name: /العربية|Arabic/ })
    .click();
  await expect(name).toHaveText("جو جلوبال");
});

test("the shell renders NO organization name when the field is absent", async ({
  page,
}) => {
  // Anchored on something positive from the same render, so the absence cannot pass against a page
  // that never mounted — and the absence is SCOPED to the navbar, never page-wide, which is the
  // rule decision 13 made unwritable.
  await openApp(page, ME);
  const sidebar = rail(page);
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator("[data-organization-name]")).toHaveCount(0);
  // NOT a placeholder: an organization name is the one string here a person reads as
  // authoritative, so inventing one would have the system assert something untrue about her
  // employer. ~80 spec mocks predate the field, which is why absent is a real state.
});
