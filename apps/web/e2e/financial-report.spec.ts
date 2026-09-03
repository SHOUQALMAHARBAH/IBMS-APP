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

const SUMMARY = {
  asOf: "2026-09-03T00:00:00.000Z",
  currency: "JOD",
  receivables: {
    outstandingTotal: "1750.000",
    current: "1000.000",
    d1_30: "500.000",
    d31_60: "0.000",
    d61_90: "0.000",
    d90_plus: "250.000",
    invoiceCount: 3,
    customerCount: 2,
  },
  payables: {
    outstandingAmount: "88000.000",
    outstandingCount: 1,
    remittedAmount: "49000.000",
    remittedCount: 2,
    insurerCount: 2,
  },
  commission: {
    earned: "18000.000",
    vat: "2880.000",
    gross: "20880.000",
    paid: "12000.000",
    reversed: "0.000",
    outstanding: "6000.000",
    entryCount: 2,
    byInsurer: [
      {
        insurerId: "ins-1",
        insurerName: "Alpha Insurance",
        earned: "18000.000",
        vat: "2880.000",
        gross: "20880.000",
        paid: "12000.000",
        reversed: "0.000",
        outstanding: "6000.000",
        entryCount: 2,
      },
    ],
  },
  profitability: {
    byLine: [
      {
        key: "Motor Fleet",
        label: "Motor Fleet",
        premiumWritten: "10000.000",
        claimsPaid: "90000.000",
        commissionEarned: "1200.000",
        netPosition: "-81200.000",
        policyCount: 1,
        claimCount: 1,
      },
    ],
    bySegment: [
      {
        key: "CORPORATE",
        label: "CORPORATE",
        premiumWritten: "130000.000",
        claimsPaid: "90000.000",
        commissionEarned: "15600.000",
        netPosition: "24400.000",
        policyCount: 2,
        claimCount: 1,
      },
    ],
    totals: {
      premiumWritten: "130000.000",
      claimsPaid: "90000.000",
      commissionEarned: "15600.000",
      netPosition: "24400.000",
      policyCount: 2,
      claimCount: 1,
    },
  },
};

async function mockSummary(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/financial-report/summary**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: SUMMARY });
  });
}

test("renders the four sections with figures from the summary", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockSummary(page);

  await page.goto("/financial-report");
  await expect(
    page.getByRole("heading", { name: "Financial report" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Client receivables" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Insurer payables" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Commission income" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Book result by line" }),
  ).toBeVisible();

  await expect(page.getByText("JOD 1,750.000")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Alpha Insurance" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Motor Fleet" })).toBeVisible();
  await expect(page.getByText("JOD -81,200.000")).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockSummary(page, { status: 403 });

  await page.goto("/financial-report");
  await expect(
    page.getByText("financial-report.view permission", { exact: false }),
  ).toBeVisible();
});

test("financial-report screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockSummary(page);

  await page.goto("/financial-report");
  await expect(page.getByRole("cell", { name: "Motor Fleet" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
