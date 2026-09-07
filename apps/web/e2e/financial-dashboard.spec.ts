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

const AGEING_BUCKETS = { current: "1000.000", d1_30: "500.000", d31_60: "0.000", d61_90: "0.000", d90_plus: "0.000" };

const SUMMARY = {
  generatedAt: "2026-09-07T00:00:00.000Z",
  asOf: "2026-09-07T00:00:00.000Z",
  currency: "JOD",
  receivables: {
    asOf: "2026-09-07T00:00:00.000Z",
    currency: "JOD",
    rows: [],
    totals: { ...AGEING_BUCKETS, outstandingTotal: "1500.000", invoiceCount: 2, customerCount: 1 },
  },
  payables: {
    asOf: "2026-09-07T00:00:00.000Z",
    currency: "JOD",
    rows: [
      { insurerId: "ins-1", insurerName: "National Insurance", outstandingAmount: "1800.000", outstandingCount: 1, oldestCollectedAt: null, oldestDaysOutstanding: -1, remittedAmount: "900.000", remittedCount: 1 },
    ],
    totals: { outstandingAmount: "1800.000", outstandingCount: 1, remittedAmount: "900.000", remittedCount: 1, insurerCount: 1 },
  },
  commission: { earned: "300.000", vat: "0.000", gross: "300.000", netEarned: "300.000", paid: "100.000", reversed: "0.000", outstanding: "200.000", entryCount: 1, byInsurer: [] },
  profitability: {
    byLine: [
      { key: "motor", label: "motor", premiumWritten: "4000.000", claimsPaid: "500.000", commissionEarned: "300.000", netPosition: "3200.000", policyCount: 1, claimCount: 1 },
    ],
    bySegment: [
      { key: "CORPORATE", label: "CORPORATE", premiumWritten: "4000.000", claimsPaid: "500.000", commissionEarned: "300.000", netPosition: "3200.000", policyCount: 1, claimCount: 1 },
    ],
    totals: { premiumWritten: "4000.000", claimsPaid: "500.000", commissionEarned: "300.000", netPosition: "3200.000", policyCount: 1, claimCount: 1 },
  },
};

test("renders every metric section with real figures", async ({ page }) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await page.route("http://localhost:4000/dashboards/financial**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/financial");
  await expect(page.getByRole("heading", { name: "Financial Dashboard" })).toBeVisible();
  await expect(page.getByText("1500.000 JOD")).toBeVisible();
  await expect(page.getByText("1800.000 JOD")).toBeVisible();
  await expect(page.getByText("300.000 JOD")).toBeVisible();
  await expect(page.getByText("3200.000", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
});

test("a user without the permission sees the underlying error message", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/dashboards/financial**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/dashboards/financial");
  await expect(
    page.getByText("You don't hold the dashboard.financial.view permission.", { exact: false }),
  ).toBeVisible();
});

test("financial dashboard screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await page.route("http://localhost:4000/dashboards/financial**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/financial");
  await expect(page.getByText("1800.000 JOD")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
