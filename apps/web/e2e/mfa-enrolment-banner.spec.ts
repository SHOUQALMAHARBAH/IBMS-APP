import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

/**
 * The signpost that was missing at the front door.
 *
 * Measured on a real first sign-in against the live stack: an administrator signs in, lands on the
 * home launcher, and every screen she clicks answers 403 — because `MfaRequiredGuard` refuses every
 * route until an authenticator is paired, and `/settings/security` is the only way through. Nothing
 * on any screen said so. Each page reported the refusal in its own words, and the insurer screens
 * said "you do not hold insurer.read" to someone who held it.
 *
 * So the shell now carries one banner, and these tests pin the three things about it that can
 * regress independently: it shows when enrolment is owed, it is suppressed on the one screen that
 * fixes it, and it goes away afterwards. The third matters most — a banner that never clears is
 * how people learn to stop reading banners.
 */

const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Office Administrator",
  languagePreference: "EN",
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(
  page: Page,
  { mfaEnabled, languagePreference = "EN" }: { mfaEnabled: boolean; languagePreference?: "AR" | "EN" },
) {
  const roles = ["OFFICE_ADMINISTRATOR"];
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, mfaEnabled, languagePreference, roles, permissions: permissionsForRoles(roles) },
    }),
  );
  // Every screen under test here is reached before enrolment, so the API would refuse its data the
  // same way the guard refuses the route. Answering 403 with the real code keeps the fixture honest
  // rather than showing a populated screen that could not exist in this state.
  await page.route("http://localhost:4000/employees**", (route) =>
    route.fulfill({
      status: 403,
      json: { code: "MFA_ENROLLMENT_REQUIRED", message: "Multi-factor authentication must be enrolled before continuing." },
    }),
  );
}

const BANNER = "[data-mfa-enrolment-banner]";

test("tells an unenrolled user what to do, on a screen that is refusing her", async ({ page }) => {
  await mockAuth(page, { mfaEnabled: false });
  await page.goto("/employees");

  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("pair an authenticator app");
  // The sentence that stops her hunting a permissions problem, which is what she did without it.
  await expect(banner).toContainText("not a problem with your permissions");

  // The link is the way out, and it has to go to the one route the guard lets through.
  const cta = banner.getByRole("link", { name: /Security/i });
  await expect(cta).toHaveAttribute("href", "/settings/security");
  await cta.click();
  await expect(page).toHaveURL(/\/settings\/security$/);
});

test("is suppressed on Security itself, where the page already says it", async ({ page }) => {
  await mockAuth(page, { mfaEnabled: false });

  // Anchored positively first: arriving on a screen that DOES show it proves the absence below is
  // a real suppression and not a page that simply failed to render.
  await page.goto("/employees");
  await expect(page.locator(BANNER)).toBeVisible();

  await page.goto("/settings/security");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(BANNER)).toHaveCount(0);
});

test("clears once an authenticator is paired", async ({ page }) => {
  await mockAuth(page, { mfaEnabled: true });
  await page.goto("/employees");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(BANNER)).toHaveCount(0);
});

test("speaks Arabic, which is the language she will read it in", async ({ page }) => {
  await mockAuth(page, { mfaEnabled: false, languagePreference: "AR" });
  await page.goto("/employees");

  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("اربط تطبيق المصادقة");
  await expect(banner.getByRole("link", { name: /الأمان/ })).toHaveAttribute(
    "href",
    "/settings/security",
  );
});

test("the banner introduces no accessibility violation @a11y", async ({ page }) => {
  await mockAuth(page, { mfaEnabled: false });
  await page.goto("/employees");
  await expect(page.locator(BANNER)).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
});
