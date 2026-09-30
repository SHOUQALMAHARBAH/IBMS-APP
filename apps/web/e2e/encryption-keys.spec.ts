import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * THE PII FIELD-ENCRYPTION KEY INVENTORY — a gated section on `/settings/security`.
 *
 * `GET /security/encryption-keys` had no web caller (IMPROVEMENTS § 1.44), so the two
 * roles holding `encryption-key.read` could not answer "which key is encrypting our
 * customers' national IDs right now, and how many retired keys are we still holding in
 * order to decrypt older rows?" without inspecting the running process.
 */

const ME = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "System Security Administrator",
  languagePreference: "EN",
  mfaEnabled: true,
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
      json: { ...ME, roles, permissions: permissionsForRoles(roles) },
    }),
  );
  // The rest of `/settings/security` — mocked so its own sections do not error over
  // the one under test.
  await page.route("http://localhost:4000/notifications", (route) =>
    route.fulfill({ status: 200, json: { items: [], total: 0 } }),
  );
  await page.route("http://localhost:4000/auth/trusted-devices", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
}

const KEYS = [
  { keyId: "pii-2026-09", active: true },
  { keyId: "pii-2025-11", active: false },
];

async function mockKeys(page: Page, rows: unknown = KEYS, status = 200) {
  await page.route("http://localhost:4000/security/encryption-keys", (route) =>
    route.fulfill({ status, json: status === 200 ? rows : { message: "no" } }),
  );
}

test("shows which key is active and which are retained only to decrypt", async ({
  page,
}) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await mockKeys(page);

  await page.goto("/settings/security");
  await expect(page.getByTestId("encryption-keys")).toBeVisible();

  // The distinction is the whole content: exactly one key is active, and a retired one
  // is still held because rows written under it must decrypt.
  await expect(page.getByTestId("encryption-key-pii-2026-09")).toContainText(
    "Active",
  );
  await expect(page.getByTestId("encryption-key-pii-2025-11")).toContainText(
    "Retired",
  );
  // And it says, on the screen, that key material is never here.
  await expect(page.getByTestId("encryption-keys")).toContainText(
    "never reaches a browser",
  );
});

test("an office administrator also holds the code and sees the inventory", async ({
  page,
}) => {
  // Two roles hold `encryption-key.read`, measured against the seeded grid, and this
  // asserts the second one rather than assuming the grid.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockKeys(page);

  await page.goto("/settings/security");
  await expect(page.getByTestId("encryption-key-pii-2026-09")).toBeVisible();
});

test("renders NOTHING for a reader without the code, not a refusal", async ({
  page,
}) => {
  // Deliberately different from the pause and correction controls: those sit on screens
  // whose purpose IS the action, so "you cannot do this" is useful. A Sales Officer came
  // here to pair an authenticator and has no reason to be told a key inventory exists.
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockKeys(page);

  await page.goto("/settings/security");
  // Anchor: the page rendered its own reason for existing before asserting the absence.
  await expect(
    page.getByRole("heading", { name: "Trusted devices" }),
  ).toBeVisible();
  await expect(page.getByTestId("encryption-keys")).toHaveCount(0);
});

test("an empty registry says so rather than rendering an empty table", async ({
  page,
}) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await mockKeys(page, []);

  await page.goto("/settings/security");
  await expect(page.getByTestId("encryption-keys")).toContainText(
    "No keys are configured",
  );
});
