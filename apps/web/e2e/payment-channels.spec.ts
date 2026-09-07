import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles } }),
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
    page.getByText("payment-channel.manage permission", { exact: false }),
  ).toBeVisible();
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
