import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

/**
 * The office's own corporate mailbox — the six `/admin/email-integration` routes, none of which had
 * a web caller, so `email.integration.read` and `email.integration.manage` were both granted and
 * neither could be exercised.
 *
 * ## What carries the weight
 *
 *  1. **`state` is compared, and a mismatch refuses.** `authorize-url` returns it and the API never
 *     sees the redirect, so the check is the screen's alone — "an authorization code accepted
 *     without checking it can be replayed from another site". A test that only drove the happy path
 *     would pass on a screen that ignored `state` entirely.
 *  2. **The deployment gap is not shown as implementation detail.** The API's 422 names environment
 *     variables; the frontend directive reserves internal detail for the System/Security
 *     Administrator. So the same refusal reads differently for two roles, and both are asserted.
 *  3. **Read and write are different grants.** Four roles see the status, two may change it, so the
 *     read-only view is a real state and not an edge case.
 *  4. **A credential rejection is not a fault in this system** and the copy must say what to do,
 *     because "the provider withdrew consent" and "the app is broken" look identical otherwise.
 */

const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Office Administrator",
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
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
  );
}

const DISCONNECTED = {
  connected: false,
  provider: null,
  connectedEmail: null,
  status: null,
  connectedAt: null,
  lastSucceededAt: null,
  lastFailedAt: null,
  lastError: null,
};

const CONNECTED = {
  connected: true,
  provider: "MICROSOFT365",
  connectedEmail: "broker@office.test",
  status: "ACTIVE",
  connectedAt: "2026-09-01T00:00:00.000Z",
  lastSucceededAt: "2026-09-27T00:00:00.000Z",
  lastFailedAt: null,
  lastError: null,
};

const STATE = "11111111-2222-3333-4444-555555555555";

async function mockStatus(page: Page, json: unknown) {
  await page.route("http://localhost:4000/admin/email-integration", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, json });
  });
}

async function mockAuthorizeUrl(page: Page) {
  await page.route(
    "http://localhost:4000/admin/email-integration/authorize-url?**",
    (route) =>
      route.fulfill({
        status: 200,
        json: { url: "https://login.microsoftonline.com/consent", state: STATE },
      }),
  );
}

test("reports that it is loading before the status arrives", async ({ page }) => {
  // The fourth state. The directive requires all four to be designed and written with the same care
  // as the populated one, so "loading" must SAY it is loading rather than render an empty status
  // block that reads as "no mailbox connected" — which is a different and alarming claim.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/admin/email-integration", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return route.fulfill({ status: 200, json: DISCONNECTED });
  });
  await page.goto("/settings/email");

  await expect(page.getByTestId("email-loading")).toBeVisible();
  // And the empty state must NOT be showing yet — otherwise the screen has already told the reader
  // no mailbox is connected while it is still finding out.
  await expect(page.getByTestId("email-empty")).toHaveCount(0);

  // Then it resolves, so the loading state is a state and not a dead end.
  await expect(page.getByTestId("email-empty")).toBeVisible({ timeout: 5000 });
});

test("says what belongs there when no mailbox is connected, and offers the one action", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockStatus(page, DISCONNECTED);
  await page.goto("/settings/email");

  // EMPTY state: the normal starting point, not a fault. It must say the consequence — nothing is
  // sent — rather than rendering a bare "no data".
  await expect(page.getByTestId("email-empty")).toContainText(
    "the system sends nothing",
  );
  await expect(page.getByTestId("email-begin")).toBeVisible();
});

test("compares the state and refuses a redirect from a different connection", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockStatus(page, DISCONNECTED);
  await mockAuthorizeUrl(page);

  let connectCalled = false;
  await page.route(
    "http://localhost:4000/admin/email-integration/connect",
    (route) => {
      connectCalled = true;
      return route.fulfill({ status: 201, json: CONNECTED });
    },
  );
  await page.goto("/settings/email");

  await page.getByTestId("email-begin").click();
  await expect(page.getByTestId("email-auth-link")).toBeVisible();

  // A redirect carrying a code but SOMEBODY ELSE'S state — the replay this check exists for.
  await page
    .getByTestId("email-redirect")
    .fill("https://ibms.example/oauth/callback?code=abc123&state=not-the-one");
  await page.getByTestId("email-mailbox").fill("broker@office.test");
  await page.getByTestId("email-connect").click();

  await expect(page.getByTestId("email-action-error")).toContainText(
    "does not match the connection this screen started",
  );
  // And nothing was sent to the server. Asserting only the message would pass on a screen that
  // complained and connected anyway.
  expect(connectCalled).toBe(false);
});

test("connects when the state matches, and says nothing has been sent yet", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockStatus(page, DISCONNECTED);
  await mockAuthorizeUrl(page);

  let body: unknown = null;
  await page.route(
    "http://localhost:4000/admin/email-integration/connect",
    (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: CONNECTED });
    },
  );
  await page.goto("/settings/email");

  await page.getByTestId("email-begin").click();
  await page
    .getByTestId("email-redirect")
    .fill(`https://ibms.example/oauth/callback?code=abc123&state=${STATE}`);
  await page.getByTestId("email-mailbox").fill("broker@office.test");
  await page.getByTestId("email-connect").click();

  await expect(page.getByTestId("email-notice")).toContainText(
    "Nothing has been sent yet",
  );
  expect(body).toMatchObject({
    provider: "MICROSOFT365",
    authorizationCode: "abc123",
    connectedEmail: "broker@office.test",
  });
  // An untouched tenant id must be ABSENT, not '' — an empty tenant is a different claim from
  // "this provider has none".
  expect(body).not.toHaveProperty("providerTenantId");
});

test("states the deployment gap in the reader's own terms, without the variable names", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockStatus(page, DISCONNECTED);
  await page.route(
    "http://localhost:4000/admin/email-integration/authorize-url?**",
    (route) =>
      route.fulfill({
        status: 422,
        json: {
          message:
            "No OAuth application is configured on this deployment for MICROSOFT365. Set the EMAIL_MS_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI environment variables.",
        },
      }),
  );
  await page.goto("/settings/email");

  await page.getByTestId("email-begin").click();
  const error = page.getByTestId("email-action-error");
  // The fact, and that it is not theirs to fix.
  await expect(error).toContainText("has not been set up for the provider");
  await expect(error).toContainText("not something you can change");
  // Anchored on the error rendering, so the absence below is not satisfied by an unrendered page.
  await expect(page.getByTestId("email-gap-detail")).toHaveCount(0);
  await expect(page.getByTestId("email-status")).not.toContainText(
    "EMAIL_MS_CLIENT_ID",
  );
});

test("shows the variable names to a System/Security Administrator, who can act on them", async ({
  page,
}) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await mockStatus(page, DISCONNECTED);
  await page.route(
    "http://localhost:4000/admin/email-integration/authorize-url?**",
    (route) =>
      route.fulfill({
        status: 422,
        json: {
          message:
            "No OAuth application is configured on this deployment for MICROSOFT365. Set the EMAIL_MS_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI environment variables.",
        },
      }),
  );
  await page.goto("/settings/email");

  await page.getByTestId("email-begin").click();
  // The same refusal, and this role additionally gets what to change. The plain sentence stays —
  // the detail is added, not substituted.
  await expect(page.getByTestId("email-action-error")).toContainText(
    "has not been set up for the provider",
  );
  await expect(page.getByTestId("email-gap-detail")).toContainText(
    "EMAIL_MS_CLIENT_ID",
  );
});

test("a credential rejection names the remedy, not a token", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockStatus(page, CONNECTED);
  await page.route("http://localhost:4000/admin/email-integration/test", (route) =>
    route.fulfill({
      status: 201,
      json: {
        outcome: "CREDENTIAL_REJECTED",
        detail: "The mailbox owner withdrew consent.",
      },
    }),
  );
  await page.goto("/settings/email");

  await page.getByTestId("email-test").click();
  const notice = page.getByTestId("email-notice");
  // "The provider withdrew consent" and "this app is broken" look identical without the remedy.
  await expect(notice).toContainText("rejected the credential");
  await expect(notice).toContainText("Connect the mailbox again");
});

test("the test message says it went to the office's OWN mailbox", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockStatus(page, CONNECTED);
  await page.route("http://localhost:4000/admin/email-integration/test", (route) =>
    route.fulfill({
      status: 201,
      json: { outcome: "SENT", fromAddress: "broker@office.test" },
    }),
  );
  await page.goto("/settings/email");

  await page.getByTestId("email-test").click();
  // Without naming the inbox, an administrator waits for a message somewhere else and concludes
  // the send failed.
  await expect(page.getByTestId("email-notice")).toContainText(
    "your office's own mailbox (broker@office.test)",
  );
});

test("verify reports a connected mailbox that cannot send, with the provider's reason", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockStatus(page, CONNECTED);
  await page.route("http://localhost:4000/admin/email-integration/verify", (route) =>
    route.fulfill({
      status: 201,
      json: {
        kind: "MICROSOFT365",
        operational: false,
        fromAddress: "broker@office.test",
        detail: "Token refresh was refused.",
      },
    }),
  );
  await page.goto("/settings/email");

  await page.getByTestId("email-verify").click();
  const notice = page.getByTestId("email-notice");
  // "Connected" and "able to send" are different facts, and only the second one matters today.
  await expect(notice).toContainText("connected and cannot send right now");
  await expect(notice).toContainText("Token refresh was refused.");
});

test("a Manager sees whether the mailbox works and is offered no control", async ({
  page,
}) => {
  // BRANCH_DEPARTMENT_MANAGER holds `email.integration.read` and NOT `.manage` — measured from the
  // seeded grid. Per the frontend directive the control does not exist rather than existing and
  // refusing the click.
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockStatus(page, CONNECTED);
  await page.goto("/settings/email");

  // Anchored on the status rendering, so the absences below cannot pass on an unmounted page.
  await expect(page.getByTestId("email-connected")).toContainText(
    "broker@office.test",
  );
  await expect(page.getByTestId("email-controls")).toHaveCount(0);
  await expect(page.getByTestId("email-verify")).toHaveCount(0);
});

test("a role without the read permission is refused the screen by name", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockStatus(page, CONNECTED);
  await page.goto("/settings/email");

  await expect(
    page.getByRole("heading", { name: "Office mailbox" }),
  ).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "email.integration.read",
  );
  await expect(page.getByTestId("email-status")).toHaveCount(0);
});

test("office mailbox screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockStatus(page, DISCONNECTED);
  await mockAuthorizeUrl(page);
  await page.goto("/settings/email");

  await page.getByTestId("email-begin").click();
  await expect(page.getByTestId("email-finish-form")).toBeVisible();

  const results = await new AxeBuilder({ page }).include("main").analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(serious).toEqual([]);
});
