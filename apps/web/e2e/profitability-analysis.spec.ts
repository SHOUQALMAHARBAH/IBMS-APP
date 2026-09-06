import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "exec@ibms.test",
  fullName: "Executive Manager",
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

const SUMMARY = {
  generatedAt: "2026-09-13T06:00:00.000Z",
  byLine: [
    {
      key: "Motor",
      commissionIncomeJod: "1000.000",
      costToServeJod: "5000.000",
      netProfitabilityJod: "-4000.000",
      policyCount: 3,
      claimCount: 2,
    },
    {
      key: "Property",
      commissionIncomeJod: "9000.000",
      costToServeJod: "1000.000",
      netProfitabilityJod: "8000.000",
      policyCount: 5,
      claimCount: 1,
    },
  ],
  bySegment: [
    {
      key: "CORPORATE",
      commissionIncomeJod: "8000.000",
      costToServeJod: "3000.000",
      netProfitabilityJod: "5000.000",
      policyCount: 6,
      claimCount: 2,
    },
    {
      key: "INDIVIDUAL",
      commissionIncomeJod: "2000.000",
      costToServeJod: "3000.000",
      netProfitabilityJod: "-1000.000",
      policyCount: 2,
      claimCount: 1,
    },
  ],
  totals: {
    commissionIncomeJod: "10000.000",
    costToServeJod: "6000.000",
    netProfitabilityJod: "4000.000",
    policyCount: 8,
    claimCount: 3,
  },
};

async function mockSummary(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/profitability-analysis", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: SUMMARY });
  });
}

test("renders both breakdowns", async ({ page }) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockSummary(page);

  await page.goto("/profitability-analysis");
  await expect(
    page.getByRole("heading", { name: "Profitability Analysis" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "Motor" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Property" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "CORPORATE" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "INDIVIDUAL" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "-4000.000" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockSummary(page, { status: 403 });

  await page.goto("/profitability-analysis");
  await expect(
    page.getByText("profitability-analysis.view permission", {
      exact: false,
    }),
  ).toBeVisible();
});

test("profitability analysis screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockSummary(page);

  await page.goto("/profitability-analysis");
  await expect(page.getByRole("cell", { name: "Motor" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
