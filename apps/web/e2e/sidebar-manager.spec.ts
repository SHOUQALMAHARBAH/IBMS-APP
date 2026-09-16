import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * The sidebar restructure, exercised through the role it was designed around.
 *
 * A Branch/Department Manager reaches 43 of the 68 gated nav items — the
 * broadest of the two roles this pass targets — so it is the one where "all 43
 * render at once" was actually a problem, and the one where collapsing,
 * searching and per-role ordering have to hold together.
 *
 * These assert BEHAVIOUR, not the item list: a spec that enumerated all 43
 * labels would fail on every future permission change and teach nobody
 * anything. The counts that matter are checked against the permission grid by
 * the analysis that produced the plan, not re-derived here.
 */

const ME_BASE = {
  id: "user-mgr",
  email: "manager@ibms.test",
  fullName: "Branch Manager",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockManager(page: Page, languagePreference: "AR" | "EN" = "EN") {
  const roles = ["BRANCH_DEPARTMENT_MANAGER"];
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, languagePreference, roles, permissions: permissionsForRoles(roles) },
    }),
  );
}

// Pinned to the API origin. A bare double-star glob on /customers would also
// match the PAGE document request and answer it with JSON, which blanks the
// whole screen — the same convention every other spec here follows.
const CUSTOMERS_URL = "http://localhost:4000/customers**";

function nav(page: Page) {
  return page.getByRole("navigation", { name: /^(Primary|التنقّل الرئيسي)$/ });
}

test("only the group holding the current route is expanded on arrival", async ({ page }) => {
  await mockManager(page);
  await page.route(CUSTOMERS_URL, (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/customers");

  const sidebar = nav(page);
  // /customers lives in Clients, so that group is open...
  await expect(sidebar.getByRole("link", { name: "Customers", exact: true })).toBeVisible();

  // ...and a sibling group's items are rendered but not reachable. Located by
  // href, NOT by role: a closed <details> removes its contents from the
  // accessibility tree outright, so getByRole finds zero — which is precisely
  // the behaviour wanted, and is also why a collapsed item cannot be
  // mistaken for a permission-hidden one by a screen reader.
  const leads = sidebar.locator('a[href="/leads"]');
  await expect(leads).toHaveCount(1);
  await expect(leads).toBeHidden();
  await expect(sidebar.getByRole("link", { name: "Leads" })).toHaveCount(0);
});

test("expanding a group is remembered on the next page load", async ({ page }) => {
  await mockManager(page);
  await page.route(CUSTOMERS_URL, (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/customers");

  const sidebar = nav(page);
  await sidebar.locator("summary", { hasText: "Finance" }).click();
  await expect(sidebar.getByRole("link", { name: "Client accounting" })).toBeVisible();

  // A full reload, not a client-side navigation — the decision has to survive
  // in localStorage, and be adopted without tripping hydration.
  await page.reload();
  await expect(nav(page).getByRole("link", { name: "Client accounting" })).toBeVisible();
});

test("collapsing a group is remembered too — the default does not win it back", async ({ page }) => {
  await mockManager(page);
  await page.route(CUSTOMERS_URL, (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/customers");

  const sidebar = nav(page);
  const customers = sidebar.getByRole("link", { name: "Customers", exact: true });
  await expect(customers).toBeVisible();

  // Closing the group the current route lives in is allowed: the stored
  // decision beats the active-route default, or the user could never collapse
  // the section they are working in.
  await sidebar.locator("summary", { hasText: "Clients" }).click();
  await expect(customers).toBeHidden();

  await page.reload();
  await expect(nav(page).getByRole("link", { name: "Customers", exact: true })).toBeHidden();
});

test("search reaches items inside collapsed groups and reports a count", async ({ page }) => {
  await mockManager(page);
  await page.route(CUSTOMERS_URL, (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/customers");

  const sidebar = nav(page);
  const leads = sidebar.getByRole("link", { name: "Leads" });
  await expect(leads).toBeHidden();

  await sidebar.getByLabel("Search modules").fill("lead");
  // New business was closed; the match is shown anyway.
  await expect(leads).toBeVisible();
  await expect(sidebar.getByText("1 match")).toBeVisible();

  // Clearing restores the collapse state rather than leaving everything open.
  await sidebar.getByLabel("Search modules").fill("");
  await expect(leads).toBeHidden();
});

test("search says so when nothing matches, rather than emptying the rail silently", async ({ page }) => {
  await mockManager(page);
  await page.route(CUSTOMERS_URL, (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/customers");

  const sidebar = nav(page);
  await sidebar.getByLabel("Search modules").fill("zzzznotamodule");
  await expect(sidebar.getByText("No module matches that. Try a shorter word.")).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Customers", exact: true })).toBeHidden();
});

test("the Manager's group order puts the book of business above administration", async ({ page }) => {
  await mockManager(page);
  await page.route(CUSTOMERS_URL, (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/customers");

  // Wait for the nav to have groups at all first: they render only once
  // /auth/me resolves, and `allInnerTexts()` does NOT auto-wait — reading it
  // too early returns [] and every index assertion below passes vacuously or
  // fails for the wrong reason.
  const sidebar = nav(page);
  await expect(sidebar.getByRole("link", { name: "Customers", exact: true })).toBeVisible();

  // Lower-cased because the group headings are uppercased in CSS and
  // `innerText` reports the rendered text, not the source string.
  const headings = await sidebar.locator("summary").allInnerTexts();
  const order = headings.map((h) => h.trim().toLowerCase());

  // Not a full-sequence assertion — that would break on any future group — but
  // the ordering decision this pass actually made: client-facing work first,
  // oversight last. NAV_ORDER_BY_ROLE is what drives it.
  expect(order.indexOf("clients")).toBe(0);
  expect(order.indexOf("new business")).toBeLessThan(order.indexOf("finance"));
  expect(order.indexOf("dashboards")).toBeLessThan(order.indexOf("administration"));
  expect(order.at(-1)).toBe("administration");
});

test("the two Retention entries are no longer both called Retention", async ({ page }) => {
  await mockManager(page);
  await page.route(CUSTOMERS_URL, (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/customers");

  const sidebar = nav(page);
  // Both are reachable, and a search for the shared word finds two distinct
  // labels rather than two identical ones.
  await sidebar.getByLabel("Search modules").fill("retention");
  await expect(sidebar.getByRole("link", { name: "Customer retention" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Retention & Disposal" })).toBeVisible();
  await expect(sidebar.getByText("2 matches")).toBeVisible();
});

test("search works in Arabic, including a query typed with a different alef", async ({ page }) => {
  await mockManager(page, "AR");
  await page.route(CUSTOMERS_URL, (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/customers");

  const sidebar = nav(page);
  // 'الاحتفاظ والإتلاف' carries إ. Typing a plain ا must still find it — the
  // folding in lib/i18n/fold.ts is what makes that true.
  await sidebar.getByLabel("البحث في الأقسام").fill("والاتلاف");
  await expect(sidebar.getByRole("link", { name: "الاحتفاظ والإتلاف" })).toBeVisible();
});
