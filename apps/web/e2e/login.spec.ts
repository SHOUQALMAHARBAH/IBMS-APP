import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("renders the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("shows a server-provided error message on invalid credentials", async ({ page }) => {
  await page.route("**/auth/login", (route) =>
    route.fulfill({ status: 401, json: { message: "Invalid email or password" } }),
  );
  await page.goto("/login");
  await page.getByLabel("Email").fill("someone@ibms.test");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // `getByRole("alert")` also matches Next.js's route-announcer div — scope
  // to the form's own error paragraph instead.
  await expect(page.locator('p[role="alert"]')).toHaveText("Invalid email or password");
});

test("switches to the MFA challenge step when the server requires it", async ({ page }) => {
  await page.route("**/auth/login", (route) =>
    route.fulfill({ status: 200, json: { mfaRequired: true, mfaChallengeToken: "fake-challenge-token" } }),
  );
  await page.goto("/login");
  await page.getByLabel("Email").fill("someone@ibms.test");
  await page.getByLabel("Password").fill("Correct-Horse-9-Battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Authentication code")).toBeVisible();
});

test("login page has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await page.goto("/login");
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(seriousOrCritical).toEqual([]);
});

test("every field is reachable via keyboard alone", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").focus();
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
});
