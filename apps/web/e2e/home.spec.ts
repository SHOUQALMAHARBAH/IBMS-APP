import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Sales Officer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, roles: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) } }),
  );
}

test("home page greets the signed-in user and shows the primary nav", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Welcome, Sales Officer" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();

  // Nav groups collapse by default and only the group holding the current
  // route opens. Home belongs to no group, so "Leads" is RENDERED but sits
  // inside a closed <details> — present in the DOM, hidden from the user,
  // which is the whole point of the restructure. Permission-hidden items are
  // a different thing entirely and have count 0 (see policies.spec.ts).
  // By href, not by role: a closed <details> drops its contents from the
  // accessibility tree, so `getByRole` legitimately finds zero.
  const leads = nav.locator('a[href="/leads"]');
  await expect(leads).toHaveCount(1);
  await expect(leads).toBeHidden();

  await nav.locator("summary", { hasText: "New business" }).click();
  await expect(leads).toBeVisible();
  await expect(nav.getByRole("link", { name: "Leads" })).toBeVisible();
});

test("redirects to /login when there is no session", async ({ page }) => {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { message: "no session" } }),
  );

  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
});

test("home page has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome, Sales Officer" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  if (results.violations.length > 0) {
    console.log(
      `axe-core found ${results.violations.length} total violation(s):`,
      results.violations.map((v) => `${v.id} (${v.impact})`),
    );
  }
  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(seriousOrCritical).toEqual([]);
});
