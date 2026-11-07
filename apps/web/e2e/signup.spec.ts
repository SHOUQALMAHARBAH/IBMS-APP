import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/*
 * ROW 66 — THE ROUTE IS CLOSED, AND THIS FILE IS WHAT KEEPS IT CLOSED.
 * Rewritten 2026-11-07 (module 0-c batch 6b), on the owner's decision.
 *
 * It held four tests of the sign-up FORM — that it renders, that it enforces the password minimum
 * client-side, that it shows the server's policy violations, and that it redirects to `/login` on
 * success. Every one of them asserted that a browser typing `/signup` could create an account,
 * which is the defect the owner closed: the account arrives with **no role at all**.
 *
 * They are replaced rather than deleted, because a closed door with no test is a door somebody
 * reopens by accident. The first test below FAILS if `SIGNUP_ROUTE_CLOSED` is removed — proven by
 * planting exactly that.
 *
 * What is NOT asserted here, deliberately: that `POST /auth/signup` refuses. It does not, and it is
 * not meant to — it is `@Public()` and 114 api e2e spec files create their users through it. The
 * property under test is the owner's own: a browser navigating to `/signup` cannot create an
 * account.
 *
 * The language pin stays: these screens render pre-authentication, so there is no
 * `user.languagePreference` to read and `LanguageProvider` falls back to the schema default, which
 * is Arabic.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ibms.languagePreference", "EN");
  });
});

test("row 66 — /signup cannot create an account: it lands on sign-in instead", async ({
  page,
}) => {
  // A request the server must never see. If the route is reopened this fires and the test fails on
  // the assertion rather than on a timeout, which is what makes the failure readable.
  let signupAttempted = false;
  await page.route("**/auth/signup", (route) => {
    signupAttempted = true;
    return route.fulfill({ status: 201, json: { id: "x", email: "x@y.test" } });
  });

  await page.goto("/signup");

  // THE POSITIVE SIGNAL FIRST: the reader is on the sign-in screen. An absence asserted without
  // this would pass against a blank page, and the sign-in heading is the thing that proves the
  // redirect happened rather than that nothing rendered.
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // And the form is gone with it — scoped to the sign-in form, because a page-wide text absence can
  // match an element the test is not about (`page-wide-absence-assertions.py`).
  await expect(
    page.getByRole("button", { name: "Create account" }),
  ).toHaveCount(0);
  expect(signupAttempted).toBe(false);
});

test("row 66 — the sign-in screen offers no way to reach it", async ({
  page,
}) => {
  // The LINK was removed in module 0-ب; this is the half that stops it coming back silently. Its
  // own comment on `/login` records why the route was left open at the time, which is the decision
  // this batch narrowed.
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: /sign up/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /create account/i })).toHaveCount(
    0,
  );
});

test("signup route has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  // Still exercised, because the route still resolves — it resolves to `/login`, so what this
  // scans is the screen a reader actually lands on from that URL.
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/login$/);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious).toEqual([]);
});
