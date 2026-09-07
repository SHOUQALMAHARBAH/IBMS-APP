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

const REPORT = {
  asOf: "2026-09-03T00:00:00.000Z",
  currency: "JOD",
  rows: [
    {
      insurerId: "acme-ins",
      insurerName: "Acme Insurance",
      outstandingAmount: "105600.000",
      outstandingCount: 1,
      oldestCollectedAt: "2026-07-15T00:00:00.000Z",
      oldestDaysOutstanding: 50,
      remittedAmount: "20000.000",
      remittedCount: 1,
    },
    {
      insurerId: "beta-ins",
      insurerName: "Beta Re",
      outstandingAmount: "0.000",
      outstandingCount: 0,
      oldestCollectedAt: null,
      oldestDaysOutstanding: -1,
      remittedAmount: "8000.000",
      remittedCount: 2,
    },
  ],
  totals: {
    outstandingAmount: "105600.000",
    outstandingCount: 1,
    remittedAmount: "28000.000",
    remittedCount: 3,
    insurerCount: 2,
  },
};

async function mockPayables(page: Page, opts: { status?: number } = {}) {
  await page.route(
    "http://localhost:4000/insurer-accounting/payables**",
    (route) => {
      if (opts.status && opts.status !== 200) {
        return route.fulfill({ status: opts.status, json: { message: "no" } });
      }
      return route.fulfill({ status: 200, json: REPORT });
    },
  );
}

test("shows the payables report worst-first with a totals row", async ({ page }) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockPayables(page);

  await page.goto("/insurer-accounting");
  await expect(
    page.getByRole("heading", { name: "Insurer accounting" }),
  ).toBeVisible();

  const firstRowCells = page.locator("tbody tr").first().locator("td");
  await expect(firstRowCells.first()).toHaveText("Acme Insurance");
  await expect(
    page.getByRole("cell", { name: "JOD 105,600.000" }).first(),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "Beta Re" })).toBeVisible();

  await expect(page.getByRole("cell", { name: "Total" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "JOD 28,000.000" }),
  ).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockPayables(page, { status: 403 });

  await page.goto("/insurer-accounting");
  await expect(
    page.getByText("insurer-accounting.read permission", { exact: false }),
  ).toBeVisible();
});

test("insurer accounting screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockPayables(page);

  await page.goto("/insurer-accounting");
  await expect(page.getByRole("cell", { name: "Acme Insurance" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
