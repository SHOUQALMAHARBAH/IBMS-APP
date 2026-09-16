import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * The two password flows: the mandatory first change (pre-auth) and the
 * self-service change (on /settings/security).
 *
 * The first one is a regression test in the strict sense. Every account made
 * through POST /admin/users carries `mustChangePassword: true`, so login
 * answers it with MUST_CHANGE_PASSWORD and an onboarding token instead of a
 * session — and the web had no branch for that outcome. It pushed to `/` with
 * no token and was bounced back to `/login` with nothing shown, so a
 * provisioned employee could not complete a first sign-in at all. That shipped
 * silently, which is exactly why it is pinned here.
 *
 * The API half of this contract is proven against a REAL provisioned user in
 * apps/api/test/auth-mfa-session.e2e-spec.ts ("Part V auth — the onboarding
 * wizard"), which calls POST /admin/users and then logs in. Web specs cannot
 * reach a live API — `npm run e2e` runs the built frontend alone — so this
 * file pins the browser half against the exact payloads that spec asserts the
 * server returns.
 */

// Pre-auth screens have no `user.languagePreference` to read, so
// LanguageProvider falls back to the schema default, Arabic. The EN pin here
// matches login.spec.ts; the Arabic rendering is asserted at the end.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ibms.languagePreference", "EN");
  });
});

const ONBOARDING_TOKEN = "onboarding-token-abc";
const GOOD_PASSWORD = "Str0ng-Passphrase!";

const ME = {
  id: "user-new",
  email: "provisioned@ibms.test",
  fullName: "New Employee",
  languagePreference: "EN",
  roles: ["SALES_RELATIONSHIP_OFFICER"],
  permissions: permissionsForRoles(["SALES_RELATIONSHIP_OFFICER"]),
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

/** What POST /auth/login returns for an account that still owes its first
 *  password change — the shape auth-mfa-session.e2e-spec.ts asserts. */
async function mockProvisionedLogin(page: Page) {
  await page.route("**/auth/login", (route) =>
    route.fulfill({
      status: 200,
      json: { outcome: "MUST_CHANGE_PASSWORD", onboardingToken: ONBOARDING_TOKEN },
    }),
  );
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("provisioned@ibms.test");
  await page.getByLabel("Password", { exact: true }).fill("Temporary-Pass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("a provisioned employee is taken to the password change, not bounced back to sign-in", async ({
  page,
}) => {
  await mockProvisionedLogin(page);
  await signIn(page);

  // The bug: this used to land back on /login with no message at all.
  await expect(page).toHaveURL(new RegExp(`/change-password\\?token=${ONBOARDING_TOKEN}`));
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
});

test("the requirements list tracks what has been typed, and gates the button", async ({ page }) => {
  await page.goto(`/change-password?token=${ONBOARDING_TOKEN}`);

  const submit = page.getByRole("button", { name: "Save and continue" });
  await expect(submit).toBeDisabled();

  const list = page.getByRole("list", { name: "Password requirements" });
  // Rendered from PASSWORD_RULES in @ibms/db — the same module the API
  // validates with — so this cannot drift below what the server accepts.
  await expect(list.getByText("At least 12 characters")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(6);

  // A password missing only the symbol still leaves the button disabled.
  await page.getByLabel("New password").fill("Str0ngPassphrase");
  await expect(page.getByLabel("A symbol — not met")).toBeVisible();
  await expect(submit).toBeDisabled();

  await page.getByLabel("New password").fill(GOOD_PASSWORD);
  await expect(page.getByLabel("A symbol — met")).toBeVisible();
  // Still disabled: confirmation has not been typed.
  await expect(submit).toBeDisabled();

  await page.getByLabel("Confirm password").fill(GOOD_PASSWORD);
  await expect(submit).toBeEnabled();
});

test("a mismatched confirmation is called out before submitting", async ({ page }) => {
  await page.goto(`/change-password?token=${ONBOARDING_TOKEN}`);
  await page.getByLabel("New password").fill(GOOD_PASSWORD);
  await page.getByLabel("Confirm password").fill(`${GOOD_PASSWORD}x`);

  await expect(page.getByText("The two passwords do not match.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save and continue" })).toBeDisabled();
});

test("completing the change signs the employee in and lands them in the app", async ({ page }) => {
  let sentToken: string | null = null;
  await page.route("**/auth/password/force-change", async (route) => {
    sentToken = (route.request().postDataJSON() as { onboardingToken: string }).onboardingToken;
    await route.fulfill({ status: 200, json: { accessToken: "fresh-token", user: ME } });
  });
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, json: ME }));
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fresh-token" } }),
  );

  await page.goto(`/change-password?token=${ONBOARDING_TOKEN}`);
  await page.getByLabel("New password").fill(GOOD_PASSWORD);
  await page.getByLabel("Confirm password").fill(GOOD_PASSWORD);
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page).toHaveURL(/\/$/);
  // The app shell, which only renders with a resolved session.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  expect(sentToken).toBe(ONBOARDING_TOKEN);
});

test("password reuse is reported in the server's own words, not a generic failure", async ({
  page,
}) => {
  // The last five hashes live only on the server; nothing on the page can
  // anticipate this, which is why the message is surfaced rather than mapped.
  await page.route("**/auth/password/force-change", (route) =>
    route.fulfill({
      status: 422,
      json: { message: "This password was used recently; choose one you have not used before" },
    }),
  );

  await page.goto(`/change-password?token=${ONBOARDING_TOKEN}`);
  await page.getByLabel("New password").fill(GOOD_PASSWORD);
  await page.getByLabel("Confirm password").fill(GOOD_PASSWORD);
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(
    page.getByText("This password was used recently; choose one you have not used before"),
  ).toBeVisible();
  await expect(page).toHaveURL(/change-password/);
});

test("arriving without a token explains itself instead of showing an empty form", async ({
  page,
}) => {
  await page.goto("/change-password");
  await expect(
    page.getByText("This step has expired. Sign in again to start over."),
  ).toBeVisible();
  await expect(page.getByLabel("New password")).toHaveCount(0);
});

test("the mandatory change screen renders in Arabic for a user who has not chosen otherwise", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.removeItem("ibms.languagePreference"));
  await page.goto(`/change-password?token=${ONBOARDING_TOKEN}`);

  await expect(page.getByRole("heading", { name: "اختر كلمة مرور جديدة" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("the mandatory password change screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await page.goto(`/change-password?token=${ONBOARDING_TOKEN}`);
  await page.getByLabel("New password").fill("partial");

  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* Part II §4.7 — the self-service change, on /settings/security       */
/* ------------------------------------------------------------------ */

async function openSecurity(page: Page) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "token" } }),
  );
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, json: ME }));
  await page.goto("/settings/security");
}

test("the security screen offers a password change beside MFA", async ({ page }) => {
  await openSecurity(page);
  await expect(page.getByRole("heading", { name: "Password" })).toBeVisible();
  await expect(page.getByLabel("Current password")).toBeVisible();
  // Gated until the current password is given — §4.7.2, so a live session on
  // an unlocked machine cannot be used to lock the real owner out.
  await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled();
});

test("a successful change reports how many other sessions were signed out", async ({ page }) => {
  await openSecurity(page);
  await page.route("**/auth/password/change", (route) =>
    route.fulfill({ status: 200, json: { otherSessionsRevoked: 2 } }),
  );

  await page.getByLabel("Current password").fill("Temporary-Pass1!");
  await page.getByLabel("New password").fill(GOOD_PASSWORD);
  await page.getByLabel("Confirm password").fill(GOOD_PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();

  await expect(page.getByText("Your password has been changed.")).toBeVisible();
  // Through tPlural, because Arabic needs six forms where English needs two.
  await expect(page.getByText("2 other sessions were signed out.")).toBeVisible();
});

test("a wrong current password shows the server's message and keeps the form", async ({ page }) => {
  await openSecurity(page);
  await page.route("**/auth/password/change", (route) =>
    route.fulfill({ status: 401, json: { message: "Current password is incorrect" } }),
  );

  await page.getByLabel("Current password").fill("not-the-password");
  await page.getByLabel("New password").fill(GOOD_PASSWORD);
  await page.getByLabel("Confirm password").fill(GOOD_PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();

  await expect(page.getByText("Current password is incorrect")).toBeVisible();
  await expect(page.getByLabel("Current password")).toBeVisible();
});
