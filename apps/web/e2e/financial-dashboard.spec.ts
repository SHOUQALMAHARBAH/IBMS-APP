import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectAbsentWithin } from "./support/anchored";

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
  await expect(page.getByText("JOD 1,500.000")).toBeVisible();
  await expect(page.getByText("JOD 1,800.000")).toBeVisible();
  /*
   * ⚠️ `.first()` ADDED 2026-11-19, and it is a CONSEQUENCE of §3 item 1 rather than a
   * loosening. «JOD 300.000» was unique on this screen while the profitability columns
   * printed raw decimals; now that `commissionEarned` is formatted too, the same text
   * occurs in the commission card AND in two table rows, and the bare locator raised a
   * strict-mode violation. The assertion is about the commission card being rendered at
   * all, which `.first()` still says.
   */
  await expect(page.getByText("JOD 300.000").first()).toBeVisible();
  /*
   * 🔴 WAS `getByText("3200.000")` — the RAW decimal string the API sends. Message 49 §3
   * item 1 put the profitability columns through `formatMoney`, so the cell reads
   * «JOD 3,200.000» now and the old substring no longer occurs: the grouping comma falls
   * between the 3 and the 200. That assertion breaking is how this change was observed.
   */
  await expect(page.getByText("JOD 3,200.000").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
});

test("🔴 message 49 §3 — every amount on this dashboard goes through formatMoney", async ({
  page,
}) => {
  /*
   * NINE amounts printed the API's raw decimal string: the four profitability columns and
   * the five receivables ageing buckets. On one screen «4000.000» stood beside
   * «JOD 1,500.000», which is the shared formatter being bypassed rather than a second
   * opinion about how money is written.
   *
   * ⚠️ ASSERTED ON THE FORMATTED FORM **AND** ON THE ABSENCE OF THE RAW ONE. The presence
   * check alone would pass against a screen that printed both, which is exactly what a
   * half-applied sweep looks like.
   */
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await page.route("http://localhost:4000/dashboards/financial**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/financial");
  const main = page.getByRole("main");

  // The four profitability columns.
  await expect(main.getByText("JOD 4,000.000").first()).toBeVisible();
  await expect(main.getByText("JOD 500.000").first()).toBeVisible();
  await expect(main.getByText("JOD 300.000").first()).toBeVisible();
  await expect(main.getByText("JOD 3,200.000").first()).toBeVisible();

  // The receivables ageing buckets — `current` and `d1_30` carry non-zero figures.
  await expect(main.getByText("JOD 1,000.000").first()).toBeVisible();

  // And the raw forms are GONE. `4000.000` and `3200.000` cannot survive the grouping
  // comma, so their absence is what says the formatter actually ran.
  await expectAbsentWithin(main, (s) => s.getByText("4000.000", { exact: false }));
  await expectAbsentWithin(main, (s) => s.getByText("3200.000", { exact: false }));
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
    page.getByText("(dashboard.financial.view)", { exact: false }),
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
  await expect(page.getByText("JOD 1,800.000")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
