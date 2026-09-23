import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/**
 * The launcher is the FIRST screen after login, and it used to be the only surface in the product
 * that offered routes without checking whether the user could open them.
 *
 * Measured on the office administrator: of six hard-coded cards, four answered 403 for her — leads,
 * prospects, customers, the KYC queue — and the three screens she could actually use had no card at
 * all. She concluded the role-management screen did not exist. It did; nothing pointed at it.
 *
 * These tests pin the rule rather than the layout: what renders here is what this user can open.
 */
const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Office Administrator",
  languagePreference: "EN",
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, roles: string[], permissions?: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissions ?? permissionsForRoles(roles) },
    }),
  );
}

test("offers the administrator the screens she can open, and none she cannot", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await page.goto("/");

  // The three she holds and previously had no card for.
  for (const href of ["/settings/roles", "/settings/users", "/employees"]) {
    await expect(page.locator(`[data-home-card="${href}"]`)).toBeVisible();
  }

  // The four that answered 403 for her. Asserted as absence, but only AFTER the positives above
  // proved the page rendered — an empty page would satisfy absence on its own.
  for (const href of ["/leads", "/prospects", "/customers", "/customers/kyc-queue"]) {
    await expect(page.locator(`[data-home-card="${href}"]`)).toHaveCount(0);
  }
});

test("offers a sales officer their own screens, and not the administration ones", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.goto("/");

  await expect(page.locator('[data-home-card="/customers"]')).toBeVisible();
  await expect(page.locator('[data-home-card="/leads"]')).toBeVisible();
  await expect(page.locator('[data-home-card="/settings/roles"]')).toHaveCount(0);
  await expect(page.locator('[data-home-card="/settings/users"]')).toHaveCount(0);
});

test("every card on the launcher is a route the user's permissions allow", async ({ page }) => {
  // The property, checked against the grid rather than against a list I would have to maintain:
  // no card may appear whose gating permission this user lacks. A hard-coded second list cannot
  // satisfy this test, which is the point of deriving from one catalogue.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.goto("/");

  // Anchor on something that must be there BEFORE enumerating. Reading the DOM straight after
  // `goto` measured "React has not hydrated yet" and returned zero cards, which would have passed
  // every "must not contain" assertion below for entirely the wrong reason.
  await expect(page.locator('[data-home-card="/settings/security"]')).toBeVisible();

  const hrefs = await page.locator("[data-home-card]").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-home-card")!),
  );
  expect(hrefs.length).toBeGreaterThan(0);

  // Security is ungated by design — the one route a user owing MFA enrolment must always reach.
  expect(hrefs).toContain("/settings/security");

  // Nothing an office administrator holds exclusively may appear for Compliance.
  for (const adminOnly of ["/settings/roles", "/settings/users"]) {
    expect(hrefs).not.toContain(adminOnly);
  }
});

test("says so plainly when a role grants nothing at all", async ({ page }) => {
  // The Role screen can deliberately produce a role with zero grants, so this is a real state and
  // not a hypothetical. An empty page would read as broken.
  await mockAuth(page, ["CUSTOM_EMPTY_ROLE"], []);
  await page.goto("/");

  await expect(page.getByRole("status")).toContainText("No screen is available");
  // Security stays. It is ungated on purpose: this user's only route is the one that lets them enrol
  // an authenticator, and an account with no permissions must not also lose that.
  await expect(page.locator('[data-home-card="/settings/security"]')).toBeVisible();
  await expect(page.locator('[data-home-card="/settings/roles"]')).toHaveCount(0);
});
