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

const SUMMARY = {
  generatedAt: "2026-09-17T10:00:00.000Z",
  sales: {
    totalCustomers: 128,
    leadsByStatus: { NEW: 4, QUALIFIED: 2 },
    prospectsByStatus: { qualifying: 3 },
    opportunitiesByStatus: { PLACEMENT: 1 },
  },
  policy: {
    policiesByStatus: { ACTIVE: 10, ISSUED: 2 },
    totalIssuedPremiumJod: "125000.000",
  },
  claims: { claimsByStatus: { NOTIFIED: 1, CLOSED: 5 } },
  finance: {
    outstandingInvoicedJod: "3400.500",
    invoicesByStatus: { INVOICED: 2, REMITTED: 8 },
    commissionThisMonthJod: "875.250",
  },
  customerService: {
    complaintsByStatus: { LOGGED: 1 },
    openServiceRequests: 3,
  },
  complianceRisk: {
    openRiskRegisterItems: 2,
    openIncidents: 0,
    openInternalAuditFindings: 1,
  },
};

async function mockSummary(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/kpi-dashboard", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: SUMMARY });
  });
}

test("renders the cross-module summary with per-domain stats and status tables", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockSummary(page);

  await page.goto("/kpi-dashboard");
  await expect(
    page.getByRole("heading", { name: "General KPI Dashboard" }),
  ).toBeVisible();
  await expect(page.getByText("128")).toBeVisible();
  await expect(page.getByText("125000.000")).toBeVisible();
  await expect(page.getByRole("cell", { name: "NEW" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Compliance & Risk" }),
  ).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockSummary(page, { status: 403 });

  await page.goto("/kpi-dashboard");
  await expect(
    page.getByText("kpi-dashboard.view permission", { exact: false }),
  ).toBeVisible();
});

test("kpi dashboard screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockSummary(page);

  await page.goto("/kpi-dashboard");
  await expect(page.getByText("128")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
