import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "dpo@ibms.test",
  fullName: "Data Protection Officer",
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

const ROWS = [
  {
    id: "dsa-1",
    vendorId: null,
    description: "Claims documents shared with a one-off external loss adjuster.",
    classification: "CONFIDENTIAL",
    channel: "ENCRYPTED_EMAIL",
    isRegulatoryChannel: false,
    requestedByUserId: "user-2",
    approvedByUserId: null,
    slaDueAt: "2026-09-10T00:00:00.000Z",
    decidedAt: null,
    createdAt: "2026-09-07T00:00:00.000Z",
    isApproved: false,
    isDeclined: false,
    isPending: true,
  },
];

test("lists data-sharing requests with the request form and approve/decline actions", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/data-sharing-approvals**", (route) =>
    route.fulfill({ status: 200, json: ROWS }),
  );

  await page.goto("/data-sharing-approvals");
  await expect(page.getByRole("heading", { name: "Third Parties & Data Sharing" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Claims documents shared with a one-off external loss adjuster." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
});

test("a user without the permission sees the underlying error message", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/data-sharing-approvals**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/data-sharing-approvals");
  await expect(
    page.getByText("You do not hold a permission required", { exact: false }),
  ).toBeVisible();
});

test("data-sharing-approvals screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/data-sharing-approvals**", (route) =>
    route.fulfill({ status: 200, json: ROWS }),
  );

  await page.goto("/data-sharing-approvals");
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
