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

const ENTRIES = [
  {
    id: "ropa-1",
    processingActivity: "KYC identity verification",
    categoriesOfData: ["national_id", "contact_details"],
    purpose: "Regulatory KYC compliance",
    recipients: ["Internal Compliance team"],
    retentionPeriodMonths: 120,
    updatedAt: "2026-09-07T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
];

test("lists RoPA entries with the create form and export button", async ({ page }) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/ropa-entries", (route) =>
    route.fulfill({ status: 200, json: ENTRIES }),
  );

  await page.goto("/ropa-entries");
  await expect(page.getByRole("heading", { name: "Records of Processing Activities" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "KYC identity verification" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add entry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export register" })).toBeVisible();
});

test("a user without the permission sees the underlying error message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/ropa-entries", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/ropa-entries");
  await expect(
    page.getByText("You do not hold a permission required", { exact: false }),
  ).toBeVisible();
});

test("ropa-entries screen has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/ropa-entries", (route) =>
    route.fulfill({ status: 200, json: ENTRIES }),
  );

  await page.goto("/ropa-entries");
  await expect(page.getByRole("button", { name: "Add entry" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
