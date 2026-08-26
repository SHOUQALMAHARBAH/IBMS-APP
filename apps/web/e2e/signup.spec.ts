import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("renders the sign-up form", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await expect(page.getByLabel("Full name")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("enforces the minimum password length client-side before submitting", async ({ page }) => {
  let requestMade = false;
  await page.route("**/auth/signup", (route) => {
    requestMade = true;
    return route.fulfill({ status: 201, json: { id: "u1", email: "a@b.com" } });
  });
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Test User");
  await page.getByLabel("Email").fill("test@ibms.test");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Sign up" }).click();
  expect(requestMade).toBe(false);
});

test("shows the server's password-policy violations on a rejected signup", async ({ page }) => {
  await page.route("**/auth/signup", (route) =>
    route.fulfill({ status: 400, json: { message: ["Password must include a digit"] } }),
  );
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Test User");
  await page.getByLabel("Email").fill("test@ibms.test");
  await page.getByLabel("Password").fill("AllLettersNoDigits!!");
  await page.getByRole("button", { name: "Sign up" }).click();
  // `getByRole("alert")` also matches Next.js's route-announcer div — scope
  // to the form's own error paragraph instead.
  await expect(page.locator('p[role="alert"]')).toContainText("Password must include a digit");
});

test("redirects to /login after a successful signup", async ({ page }) => {
  await page.route("**/auth/signup", (route) =>
    route.fulfill({ status: 201, json: { id: "u1", email: "test@ibms.test" } }),
  );
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Test User");
  await page.getByLabel("Email").fill("test@ibms.test");
  await page.getByLabel("Password").fill("Correct-Horse-9-Battery!");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("signup page has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await page.goto("/signup");
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(seriousOrCritical).toEqual([]);
});
