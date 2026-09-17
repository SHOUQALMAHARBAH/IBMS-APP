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

// The pre-authentication default. Until this pass the sign-in screen was
// hard-coded English, so an Arabic-preferring user met an English form before
// they had any way to switch — and no test could tell, because there was
// nothing else for it to render. `dir="rtl"` is asserted alongside the copy:
// translated text in a left-to-right document is only half the job.
test("renders in Arabic with RTL direction when no preference is stored", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem('ibms.languagePreference');
  });
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "تسجيل الدخول" }),
  ).toBeVisible();
  await expect(page.getByLabel("البريد الإلكتروني")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // The English it used to show, and must not any more.
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
});
