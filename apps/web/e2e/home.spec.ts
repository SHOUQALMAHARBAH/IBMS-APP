import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles } }),
  );
}

test("home page greets the signed-in user and shows the primary nav", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Welcome, Sales Officer" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Leads" }),
  ).toBeVisible();
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
