import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { anchoredAttributes, anchoredTexts } from "./support/anchored";

/*
 * The Executive half of the sidebar restructure.
 *
 * Structure, collapsing and search are shared with the Manager and are covered
 * once, in sidebar-manager.spec.ts. What is genuinely different for this role —
 * and so what is asserted here — is ORDER: an Executive reads the numbers
 * first, and the one screen named after them is hoisted to the top of its own
 * group rather than sitting eighth.
 */

const ME_BASE = {
  id: "user-exec",
  email: "exec@ibms.test",
  fullName: "Executive",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockExecutive(page: Page, languagePreference: "AR" | "EN" = "EN") {
  const roles = ["EXECUTIVE_MANAGEMENT"];
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

// Pinned to the API origin, like every other spec here: a bare double-star
// glob would also match the PAGE document request and answer it with JSON.
//
// /customers rather than a dashboard, deliberately. Group ORDER does not
// depend on which page you are on, and an empty customer list is a fixture
// shape this suite already proves elsewhere — where a hand-rolled `{}` for a
// dashboard crashed the page into Chrome's own "This page couldn't load",
// which is not a sidebar failure but would read like one.
const CUSTOMERS_URL = "http://localhost:4000/customers**";

function nav(page: Page) {
  return page.getByRole("navigation", { name: /^(Primary|التنقّل الرئيسي)$/ });
}

async function openCustomers(page: Page, language: "AR" | "EN" = "EN") {
  await mockExecutive(page, language);
  await page.route(CUSTOMERS_URL, (route) => route.fulfill({ status: 200, json: { items: [], total: 0, page: 0, pageSize: 50 } }));
  await page.goto("/customers");
}

/** Hrefs in DOM order inside the group that owns the executive dashboard.
 *  Read as attributes, not innerText: a collapsed group's links have no
 *  rendered text, and this has to work whether the group is open or not. */
async function dashboardHrefs(page: Page): Promise<(string | null)[]> {
  const group = nav(page).locator('details:has(a[href="/dashboards/executive"])');
  // Anchored on the GROUP, never on its links: a collapsed group's links have no bounding box, so
  // they cannot vouch for their own presence — and reading them while collapsed is the point.
  return anchoredAttributes(group.locator("a"), "href", group);
}

test("the Executive's order leads with the numbers, not the pipeline", async ({ page }) => {
  await openCustomers(page);

  const sidebar = nav(page);
  const order = (await anchoredTexts(sidebar.locator("summary"))).map((h) => h.trim().toLowerCase());

  // The mirror image of the Manager, whose first group is Clients.
  expect(order[0]).toBe("dashboards");
  expect(order[1]).toBe("performance & analysis");
  expect(order.indexOf("finance")).toBeLessThan(order.indexOf("clients"));
  expect(order.indexOf("clients")).toBeLessThan(order.indexOf("new business"));
  expect(order.at(-1)).toBe("administration");
});

test("Executive Dashboard is hoisted to the top of its own group", async ({ page }) => {
  await openCustomers(page);

  const sidebar = nav(page);
  await expect(sidebar.getByRole("link", { name: "Customers", exact: true })).toBeVisible();

  // Global item order puts it eighth of eight. `hoist` lifts it for this role
  // only, and lifts nothing else — the rest keep their global sequence.
  const hrefs = await dashboardHrefs(page);
  expect(hrefs[0]).toBe("/dashboards/executive");
  expect(hrefs[1]).toBe("/kpi-dashboard");
  expect(hrefs).toHaveLength(8);
});

test("the same item is NOT hoisted for a Manager — the exception is per role", async ({ page }) => {
  const roles = ["BRANCH_DEPARTMENT_MANAGER"];
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, languagePreference: "EN", roles, permissions: permissionsForRoles(roles) },
    }),
  );
  await page.route(CUSTOMERS_URL, (route) => route.fulfill({ status: 200, json: { items: [], total: 0, page: 0, pageSize: 50 } }));
  await page.goto("/customers");

  const sidebar = nav(page);
  await expect(sidebar.getByRole("link", { name: "Customers", exact: true })).toBeVisible();

  const hrefs = await dashboardHrefs(page);
  expect(hrefs[0]).toBe("/kpi-dashboard");
  expect(hrefs.at(-1)).toBe("/dashboards/executive");
});

test("an Executive sees no Privacy or Operations group at all", async ({ page }) => {
  await openCustomers(page);

  const sidebar = nav(page);
  await expect(sidebar.getByRole("link", { name: "Customers", exact: true })).toBeVisible();

  // Not collapsed — absent. The role holds none of those permissions, and an
  // empty group must never render a header with nothing behind it.
  const order = (await anchoredTexts(sidebar.locator("summary"))).map((h) => h.trim().toLowerCase());
  expect(order).not.toContain("privacy & data protection");
  expect(order).not.toContain("operations");
  expect(order).toHaveLength(9);
});

test("search reaches an Executive-only screen inside a collapsed group", async ({ page }) => {
  await openCustomers(page);

  const sidebar = nav(page);
  // Strategic planning inputs lives in Performance & analysis, which is closed
  // on arrival because the current route is in Clients.
  const planning = sidebar.locator('a[href="/planning-export"]');
  await expect(planning).toBeHidden();

  await sidebar.getByLabel("Search modules").fill("planning");
  await expect(planning).toBeVisible();
  await expect(sidebar.getByText("1 match")).toBeVisible();
});

test("the Executive sidebar works in Arabic", async ({ page }) => {
  await openCustomers(page, "AR");

  const sidebar = nav(page);
  await expect(sidebar.getByRole("link", { name: "العملاء", exact: true })).toBeVisible();

  const order = (await anchoredTexts(sidebar.locator("summary"))).map((h) => h.trim());
  expect(order[0]).toBe("اللوحات");
  expect(order[1]).toBe("الأداء والتحليل");
});
