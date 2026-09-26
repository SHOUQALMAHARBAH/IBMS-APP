import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

const ME_BASE = {
  id: "user-1",
  email: "finance@ibms.test",
  fullName: "Finance Officer",
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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) } }),
  );
}

/**
 * Four-action Phase 4 — an EXACT permission set, not a role's.
 *
 * `payment-channel.manage` became `.read` / `.create` / `.deactivate`, and every seeded role that held the
 * umbrella received all three. So no role name can express "can see the list, cannot add a destination for
 * client money" — which is precisely the state an office creates the moment it uses the Role screen, and
 * the only state in which the split is observable at all. The api-side equivalent is
 * `four-action-separability.e2e-spec.ts`, which builds a real role for the same reason.
 */
async function mockAuthWithCodes(page: Page, permissions: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles: ["FINANCE_COLLECTIONS_OFFICER"], permissions },
    }),
  );
}

const CHANNELS = [
  {
    id: "pc-1",
    ownerType: "customer",
    customerId: "cust-1",
    insurerId: null,
    channelType: "bank_transfer",
    label: "Client — Cairo Amman JOD",
    bankName: "Cairo Amman Bank",
    accountLast4: "4321",
    currency: "JOD",
    status: "active",
    isActive: true,
    disabledAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "pc-2",
    ownerType: "insurer",
    customerId: null,
    insurerId: "ins-1",
    channelType: "cheque",
    label: "Insurer settlement",
    bankName: null,
    accountLast4: null,
    currency: "JOD",
    status: "disabled",
    isActive: false,
    disabledAt: "2026-09-20T00:00:00.000Z",
    createdAt: "2026-09-02T00:00:00.000Z",
  },
];

async function mockChannels(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/payment-channels**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: CHANNELS });
  });
}

test("lists customer + insurer channels with masked account fragments", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockChannels(page);

  await page.goto("/payment-channels");
  await expect(
    page.getByRole("heading", { name: "Payment channels" }),
  ).toBeVisible();

  await expect(page.getByRole("cell", { name: "••••4321" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Active", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Disabled", exact: true }),
  ).toBeVisible();

  // Finance sees the add form
  await expect(page.getByLabel("Owner type")).toBeVisible();
  await expect(page.getByLabel("Account last 4")).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockChannels(page, { status: 403 });

  await page.goto("/payment-channels");
  await expect(
    // Four-action Phase 4 — the load failed, so the refusal names the READ code, not a write one. Telling
    // somebody they lack the permission to ADD a channel when what they cannot do is SEE the list would
    // send them to ask for the wrong grant.
    page.getByText("payment-channel.read permission", { exact: false }),
  ).toBeVisible();
});

test("the read code alone shows the list and NEITHER write control", async ({
  page,
}) => {
  // The state no role name can express, and the only one in which Phase 4's split is visible on screen.
  await mockAuthWithCodes(page, ["payment-channel.read"]);
  await mockChannels(page);

  await page.goto("/payment-channels");

  // The anchor, asserted FIRST: the list rendered. Without it the two absences below are satisfied by a
  // page that never loaded, which cannot tell "the control is correctly withheld" from "nothing rendered".
  await expect(page.getByRole("cell", { name: "••••4321" })).toBeVisible();

  await expectNone(page.getByLabel("Account last 4"), page.getByRole("cell", { name: "••••4321" }));
  await expectNone(
    page.getByRole("button", { name: "Disable" }),
    page.getByRole("cell", { name: "••••4321" }),
  );
});

test("the create code adds the form back without the disable button", async ({
  page,
}) => {
  // The inverse, which is the direction that would go unnoticed: a create code quietly carrying the
  // deactivate is the umbrella surviving under a narrower name.
  await mockAuthWithCodes(page, ["payment-channel.read", "payment-channel.create"]);
  await mockChannels(page);

  await page.goto("/payment-channels");
  await expect(page.getByLabel("Account last 4")).toBeVisible();
  await expectNone(
    page.getByRole("button", { name: "Disable" }),
    page.getByLabel("Account last 4"),
  );
});

test("payment-channels screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockChannels(page);

  await page.goto("/payment-channels");
  await expect(page.getByRole("cell", { name: "••••4321" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
