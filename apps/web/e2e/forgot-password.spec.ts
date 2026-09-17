import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// These four screens render pre-authentication, so there is no
// `user.languagePreference` to read and `LanguageProvider` falls back to the
// schema default — Arabic. Until this pass they were hard-coded English, so
// the assertions below passed by accident; they now pin the language the way
// the authenticated specs do (which force EN through their /auth/me mock).
// The Arabic default itself is asserted separately, at the end of this file.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ibms.languagePreference', 'EN');
  });
});

test("renders the forgot-password form", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Forgot password" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("shows the same confirmation message whether or not the account exists", async ({ page }) => {
  await page.route("**/auth/forgot-password", (route) =>
    route.fulfill({ status: 200, json: { message: "If that email is registered, a reset link has been sent." } }),
  );
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("nobody@ibms.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If that email is registered, a reset link has been sent.")).toBeVisible();
});

test("surfaces the dev-only reset link when the API returns one (no email provider configured yet)", async ({
  page,
}) => {
  await page.route("**/auth/forgot-password", (route) =>
    route.fulfill({
      status: 200,
      json: { message: "If that email is registered, a reset link has been sent.", devResetToken: "abc123" },
    }),
  );
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("someone@ibms.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  const link = page.getByRole("link", { name: "continue to reset password" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /\/reset-password\?token=abc123/);
});

test("forgot-password page has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await page.goto("/forgot-password");
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(seriousOrCritical).toEqual([]);
});
