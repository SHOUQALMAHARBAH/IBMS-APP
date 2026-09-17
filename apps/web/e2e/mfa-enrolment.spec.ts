import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * MFA enrolment — the regression test for "a correct code reported as invalid".
 *
 * `POST /auth/mfa/totp/enroll/verify` is typed `Promise<void>` on the service
 * and carries `@HttpCode(200)`, so NestJS answers **200 with an empty body**.
 * The web client called `res.json()` on that, which throws a SyntaxError —
 * NOT an `ApiError` — so the handler's
 * `err instanceof ApiError ? err.message : t('secInvalidCode')` fell through to
 * its fallback and told the user "Invalid code — try again" while MFA had in
 * fact just been enabled on their account.
 *
 * `/settings/security` had no e2e coverage at all, which is why this survived.
 *
 * The first test below is the one that matters: it answers the verify endpoint
 * with an empty 200 — exactly what the real API returns — and asserts the
 * SUCCESS message. Against the unfixed client it fails, reporting the invalid
 * code message instead.
 */

const ME = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Verification Officer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

/** A 1x1 transparent PNG — the enrolment response carries a QR data URL. */
const QR =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function mockAuth(page: Page, lang: "AR" | "EN" = "EN") {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME,
        languagePreference: lang,
        roles: ["SALES_RELATIONSHIP_OFFICER"],
        permissions: permissionsForRoles(["SALES_RELATIONSHIP_OFFICER"]),
      },
    }),
  );
  await page.route("http://localhost:4000/notifications", (route) =>
    route.fulfill({ status: 200, json: { items: [], total: 0 } }),
  );
  await page.route("http://localhost:4000/auth/trusted-devices", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/auth/mfa/totp/enroll", (route) =>
    route.fulfill({
      status: 201,
      json: { credentialId: "cred-1", qrCodeDataUrl: QR, secret: "ABCDEFGH" },
    }),
  );
}

async function startEnrolment(page: Page, enrollLabel: string) {
  await page.goto("/settings/security");
  await page.getByRole("button", { name: enrollLabel }).click();
}

test("a correct code reports success, even though the API answers 200 with an empty body", async ({
  page,
}) => {
  await mockAuth(page);
  // Exactly what NestJS sends for a `Promise<void>` handler under
  // @HttpCode(200): status 200, no body at all. `json:` would send "null",
  // which is valid JSON and would NOT reproduce the bug — the body has to be
  // genuinely empty.
  await page.route(
    "http://localhost:4000/auth/mfa/totp/enroll/verify",
    (route) => route.fulfill({ status: 200, body: "", contentType: "" }),
  );

  await startEnrolment(page, "Enroll authenticator app");
  await page.getByLabel("Authentication code").fill("123456");
  await page.getByRole("button", { name: "Verify and enable" }).click();

  await expect(
    page.getByText("Multi-factor authentication is now enabled on your account."),
  ).toBeVisible();
  // The precise failure being guarded: a correct code must never be reported
  // back to the user as an invalid one.
  await expect(page.getByText("Invalid code — try again.")).toHaveCount(0);
});

test("a genuinely rejected code still reports the API's own message", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(
    "http://localhost:4000/auth/mfa/totp/enroll/verify",
    (route) =>
      route.fulfill({
        status: 401,
        json: { message: "That code did not match. Check your authenticator." },
      }),
  );

  await startEnrolment(page, "Enroll authenticator app");
  await page.getByLabel("Authentication code").fill("000000");
  await page.getByRole("button", { name: "Verify and enable" }).click();

  // The server's own wording, not the generic fallback — the fallback exists
  // for a non-ApiError failure, which a 401 is not.
  await expect(
    page.getByText("That code did not match. Check your authenticator."),
  ).toBeVisible();
  await expect(
    page.getByText("Multi-factor authentication is now enabled on your account."),
  ).toHaveCount(0);
});

test("the same success path reports correctly in Arabic", async ({ page }) => {
  await mockAuth(page, "AR");
  await page.route(
    "http://localhost:4000/auth/mfa/totp/enroll/verify",
    (route) => route.fulfill({ status: 200, body: "", contentType: "" }),
  );

  await startEnrolment(page, "تسجيل تطبيق المصادقة");
  await page.getByLabel("رمز المصادقة").fill("123456");
  await page.getByRole("button", { name: "التحقّق والتفعيل" }).click();

  await expect(
    page.getByText("تم تفعيل المصادقة متعدّدة العوامل على حسابك."),
  ).toBeVisible();
  await expect(page.getByText("رمز غير صحيح — حاول مرة أخرى.")).toHaveCount(0);
});

test("security screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  await mockAuth(page);
  await page.goto("/settings/security");
  await expect(
    page.getByRole("heading", { name: "Multi-factor authentication" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
});
