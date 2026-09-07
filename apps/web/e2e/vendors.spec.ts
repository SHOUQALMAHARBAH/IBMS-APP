import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "manager@ibms.test",
  fullName: "Branch Manager",
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

const VENDOR = {
  id: "vendor-1",
  name: "Acme Office Supplies",
  vendorType: "other",
  riskTier: null,
  annualReviewDueAt: null,
  terminationDataReturnConfirmedAt: null,
  accessRevokedAt: null,
  createdAt: "2026-09-18T09:00:00.000Z",
};

test("renders the vendor list with the create form", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/vendors", (route) =>
    route.fulfill({ status: 200, json: [VENDOR] }),
  );

  await page.goto("/vendors");
  await expect(page.getByRole("heading", { name: "Vendors" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Acme Office Supplies" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Record a new vendor" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/vendors", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );

  await page.goto("/vendors");
  await expect(
    page.getByText("vendor.manage permission", { exact: false }),
  ).toBeVisible();
});

test("renames a vendor inline", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  let current = { ...VENDOR };
  await page.route("http://localhost:4000/vendors", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, json: [current] });
    }
    return route.fallback();
  });
  await page.route("http://localhost:4000/vendors/vendor-1", (route) => {
    current = { ...current, name: "Acme Office Supplies Ltd" };
    return route.fulfill({ status: 200, json: current });
  });

  await page.goto("/vendors");
  await expect(page.getByRole("cell", { name: "Acme Office Supplies" })).toBeVisible();
  await page.getByRole("button", { name: "Rename" }).click();
  await page
    .getByRole("row", { name: "Acme Office Supplies other" })
    .getByRole("textbox")
    .fill("Acme Office Supplies Ltd");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: "Acme Office Supplies Ltd" })).toBeVisible();
});

test("vendors screen has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/vendors", (route) =>
    route.fulfill({ status: 200, json: [VENDOR] }),
  );

  await page.goto("/vendors");
  await expect(page.getByRole("cell", { name: "Acme Office Supplies" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
